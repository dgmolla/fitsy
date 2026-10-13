"""Behavioral resource decisions. These do not claim installed/runtime enforcement."""
import copy
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from resource_lifecycle import (resource_intent, resource_acquired, execution_capacity,
                                docker_retention, retention)

GIB = 1024**3


class ResourceControlsTest(unittest.TestCase):
    def setUp(self):
        # Exactly representable before and after ISO microsecond serialization.
        self.now = 1791935400.125
        self.budget = dict(peak_memory_bytes=4*GIB, host_reserve_bytes=3*GIB,
                           cpus=2, scratch_bytes=4*GIB)
        self.observed = dict(state='available', at=self.now, free_disk_bytes=20*GIB,
                             disk_floor_bytes=8*GIB, available_memory_bytes=9*GIB,
                             heavy_jobs=0, swap_growth_bytes=0, memory_pressure='normal',
                             host_memory_bytes=16*GIB, available_cpus=4)
        self.identity = dict(context='fixture', daemon='daemon-one', name='fixture-volume', created_at='one')
        self.record = dict(claim='fixture-owner', issue=463, kind='volume', identity=self.identity,
                           state='released', disposable=True, recreation=['reseed', 'fixture-volume'],
                           last_owner_use=self.now-15000, released_at=self.now-14401,
                           consumers=[], dependencies=[])
        self.inventory = dict(state='available', complete=True, at=self.now, containers=[],
                              objects=[dict(kind='volume', identity=self.identity, active=False, shared=False)])

    def test_interrupted_acquisition_is_retained_without_fabricated_identity(self):
        claim = {'id': 'original-claim', 'issue': 463}
        resource_intent(claim, 'device', 'simulator', 'acceptance', ['create', 'fixture'])
        self.assertEqual(claim['resources']['device']['state'], 'acquiring')
        with self.assertRaises(ValueError):
            resource_intent(claim, 'device', 'simulator', 'acceptance', ['create', 'fixture'])
        with self.assertRaises(ValueError):
            resource_acquired(claim, 'device', {}, time.time())
        resource_acquired(claim, 'device', {'udid': 'exact-device'}, time.time())
        self.assertEqual(claim['resources']['device']['identity'], {'udid': 'exact-device'})
        with self.assertRaises(ValueError):
            resource_acquired(claim, 'device', {'udid': 'replacement'}, time.time())

    def test_host_admission_requires_headroom_and_fresh_complete_measurements(self):
        self.assertEqual(execution_capacity(self.budget, self.observed, self.now)['state'], 'admitted')
        for change in ({'heavy_jobs': 1}, {'available_memory_bytes': 6*GIB},
                       {'swap_growth_bytes': 1}, {'memory_pressure': 'critical'},
                       {'at': self.now-61}, {'at': self.now+1}, {'free_disk_bytes': 11*GIB},
                       {'state': 'unavailable'}, {'available_cpus': 1}, {'host_memory_bytes': float('nan')}):
            with self.subTest(change=change):
                self.assertEqual(execution_capacity(self.budget, {**self.observed, **change}, self.now)['state'],
                                 'resource-hold')
        self.assertEqual(execution_capacity({}, self.observed, self.now)['state'], 'resource-hold')

    def test_docker_admission_inspects_effective_limits_and_vm_aggregate(self):
        budget = {**self.budget, 'docker': True, 'memory_swap_bytes': 4*GIB}
        docker = dict(state='available', vm_memory_bytes=8*GIB, vm_swap_bytes=0, vm_cpus=4,
                      used_memory_swap_budget_bytes=2*GIB,
                      used_memory_budget_bytes=2*GIB, used_cpus=1,
                      effective_memory_bytes=4*GIB, effective_memory_swap_bytes=4*GIB, effective_cpus=2)
        observed = {**self.observed, 'docker': docker}
        self.assertEqual(execution_capacity(budget, observed, self.now)['state'], 'admitted')
        for change in ({'state': 'unavailable'}, {'effective_memory_bytes': 0},
                       {'effective_memory_swap_bytes': -1}, {'effective_cpus': 0},
                       {'used_memory_budget_bytes': 5*GIB}, {'used_memory_swap_budget_bytes': 5*GIB},
                       {'used_cpus': 3}, {'vm_memory_bytes': 14*GIB}):
            with self.subTest(change=change):
                self.assertEqual(execution_capacity(budget, {**observed, 'docker': {**docker, **change}},
                                                   self.now)['state'], 'resource-hold')

    def test_strict_four_hour_boundary_even_with_pressure_and_zero_configured_ttl(self):
        for age, expected in ((14399, 'retained'), (14400, 'retained'), (14401, 'assessment-due')):
            record = {**self.record, 'released_at': self.now-age}
            self.assertEqual(docker_retention(record, self.inventory, self.now)['state'], expected)
            stamp = __import__('datetime').datetime.fromtimestamp(self.now-age,
                      __import__('datetime').timezone.utc).isoformat()
            self.assertEqual(retention({'resource_ttl_seconds': {'build_cache': 0}, 'build_cache_max_bytes': 0},
                             'build_cache', {'last_owner_use': stamp, 'bytes': 1}, self.now)['state'], expected)

    def test_active_shared_unfinished_and_unknown_resources_stay(self):
        for change in ({'state': 'acquiring'}, {'disposable': False}, {'recreation': []},
                       {'claim': None}, {'consumers': ['live-owner']}, {'dependencies': ['unfinished-outcome']},
                       {'last_owner_use': None}, {'released_at': self.now+1}):
            with self.subTest(change=change):
                self.assertEqual(docker_retention({**self.record, **change}, self.inventory, self.now)['state'], 'retained')
        for change in ({'active': True}, {'shared': True}, {'shared': None}):
            inventory = {**self.inventory, 'objects': [{**self.inventory['objects'][0], **change}]}
            self.assertEqual(docker_retention(self.record, inventory, self.now)['state'], 'retained')

    def test_stopped_container_dependency_and_reused_volume_name_are_retained(self):
        inventory = {**self.inventory, 'containers': [{'running': False, 'references': [self.identity]}]}
        self.assertEqual(docker_retention(self.record, inventory, self.now)['state'], 'retained')
        reused = copy.deepcopy(self.inventory)
        reused['objects'][0]['identity']['created_at'] = 'replacement'
        self.assertEqual(docker_retention(self.record, reused, self.now)['state'], 'retained')

    def test_offline_partial_and_stale_inventory_never_imply_zero_usage(self):
        for change in ({'state': 'unavailable'}, {'complete': False}, {'at': self.now-61},
                       {'containers': [{}]}, {'objects': []}):
            self.assertEqual(docker_retention(self.record, {**self.inventory, **change}, self.now)['state'], 'retained')

    def test_all_docker_kinds_require_exact_identity_and_dedicated_builder(self):
        for kind in ('container', 'image', 'volume', 'network', 'builder'):
            record = {**self.record, 'kind': kind}
            obj = {**self.inventory['objects'][0], 'kind': kind, 'dedicated': True}
            inventory = {**self.inventory, 'objects': [obj]}
            self.assertEqual(docker_retention(record, inventory, self.now)['state'], 'assessment-due')
            if kind == 'builder':
                obj['dedicated'] = False
                self.assertEqual(docker_retention(record, inventory, self.now)['state'], 'retained')


if __name__ == '__main__':
    unittest.main()
