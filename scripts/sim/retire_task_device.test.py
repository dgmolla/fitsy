"""Actual disposable simctl boundary for verified task-device retirement."""

import json
import fcntl
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
import subprocess
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import retire_task_device as retirement


class RetirementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.issue = 412
        self.udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        self.worktree = self.root / 'fitsy-issue-412-claim123'
        self.app = self.worktree / '.evidence/product-build/Build/Products/Release-iphonesimulator/Fitsy.app'
        self.app.mkdir(parents=True)
        (self.app / 'main.jsbundle').write_text('exported app')
        recipe = self.worktree / 'scripts/sim'
        recipe.mkdir(parents=True)
        (recipe / 'product-flow.mjs').write_text('product flow recipe')
        (recipe / 'build-profile.mjs').write_text('build profile recipe')
        self.flow = self.worktree / '.evidence/product-flow'
        self.flow.mkdir(parents=True)
        (self.flow / 'mcp.jsonl').write_bytes(b'{}\n')
        flows = []
        for name in ('cold-start-welcome', 'signin-options'):
            source = self.worktree / f'apps/mobile/e2e/flows/{name}.yaml'
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(f'name: {name}\n')
            commands = self.flow / f'{name}-commands.json'
            commands.write_text(json.dumps([
                {'command': {'applyConfigurationCommand': {'config': {'appId': 'com.fitsy.mobile', 'name': name}}},
                 'metadata': {'status': 'COMPLETED'}},
                {'command': {'assertConditionCommand': {'optional': False}}, 'metadata': {'status': 'COMPLETED'}}]))
            screenshot = self.flow / f'{name}-outcome.png'
            screenshot.write_bytes(bytes.fromhex('89504e470d0a1a0a') + b'png')
            capture = self.flow / f'{name}-capture.jsonl'
            capture.write_text(json.dumps({'udid': self.udid, 'preferredScreenCaptureFormat': 'screenshots'}) + '\n')
            closeout = self.flow / f'{name}-closeout.json'
            closeout.write_text(json.dumps({'udid': self.udid, 'generated': {'videos': 0}, 'deleted': []}))
            flows.append({'name': name, 'source': str(source.relative_to(self.worktree)),
                'sourceHash': retirement.digest(source), 'commands': commands.name, 'sha256': retirement.digest(commands),
                'screenshot': screenshot.name, 'screenshotHash': retirement.digest(screenshot),
                'captureReceipt': capture.name, 'captureReceiptHash': retirement.digest(capture),
                'attachmentCloseout': closeout.name, 'attachmentCloseoutHash': retirement.digest(closeout)})
        subprocess.run(['git', 'init', '-q', str(self.worktree)], check=True)
        subprocess.run(['git', '-C', str(self.worktree), 'add', 'apps', 'scripts'], check=True)
        identity = {'configHash': 'c' * 64, 'nativeSourceHash': retirement.input_hash(self.worktree, True),
                    'buildRecipeHash': retirement.recipe_hash(self.worktree),
                    'bundleHash': retirement.digest(self.app / 'main.jsbundle'),
                    'buildMode': 'embedded-release', 'configuration': 'Release', 'storeMode': 'unconfigured'}
        (self.flow / 'report.json').write_text(json.dumps({'simulator': self.udid, 'result': 'pass',
            'evidenceMode': 'final-candidate', 'finishedAt': '2026-09-28T00:00:00Z',
            'appHash': retirement.app_hash(self.app), 'inputHash': retirement.input_hash(self.worktree),
            **identity, 'flows': flows,
            'exploration': [{'trace': 'mcp.jsonl', 'sha256': retirement.digest(self.flow / 'mcp.jsonl')}]}))
        (self.worktree / '.evidence/product-build/receipt.json').write_text(json.dumps({
            'simulator': self.udid, 'app': str(self.app), 'appHash': retirement.app_hash(self.app), **identity}))
        self.devices = self.root / 'devices'
        self.attachment = self.devices / self.udid / 'data/Containers/Data/InternalDaemon/owner/Attachments/raw-without-extension'
        self.attachment.parent.mkdir(parents=True)
        self.attachment.write_bytes(b'raw evidence')
        self.archive = self.root / 'archive'
        self.claim = self.root / '.fitsy-sim-claim.json'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        xcrun = self.bin / 'xcrun'
        xcrun.write_text('''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
udid=os.environ['FAKE_UDID']; root=Path(os.environ['FAKE_DEVICE_ROOT'])
if sys.argv[1:3] == ['simctl','list']:
 present=(root/udid).exists() and os.environ.get('FAKE_HIDE_DEVICE') != '1'
 print(json.dumps({'devices': {'iOS': [{'udid':udid,'name':os.environ.get('FAKE_DEVICE_NAME','Fitsy-Issue-412'),'state':os.environ.get('FAKE_DEVICE_STATE','Shutdown')}] if present else []}}))
elif sys.argv[1:3] == ['simctl','delete']:
 shutil.rmtree(root/udid); Path(os.environ['FAKE_DELETED']).write_text(udid)
else: raise SystemExit(2)
''')
        xcrun.chmod(0o700)
        ps = self.bin / 'ps'
        ps.write_text('#!/bin/sh\nexit 0\n')
        ps.chmod(0o700)
        lsof = self.bin / 'lsof'
        lsof.write_text('''#!/bin/sh
if [ "$FAKE_LSOF_CHECKOUT" = 1 ] && [ "$2" = "$FAKE_WORKTREE" ]; then
  printf 'COMMAND PID USER FD TYPE NAME\\nnode 123 test cwd DIR %s\\n' "$FAKE_WORKTREE"
  exit 0
fi
exit 1
''')
        lsof.chmod(0o700)
        cp = self.bin / 'cp'
        cp.write_text('''#!/usr/bin/env python3
import shutil,sys
if sys.argv[1:3] != ['-c','-p'] or len(sys.argv) != 5:
    raise SystemExit(2)
shutil.copy2(sys.argv[3],sys.argv[4])
''')
        cp.chmod(0o700)
        self.env = mock.patch.dict(os.environ, {'PATH': str(self.bin) + ':' + os.environ['PATH'],
            'FAKE_UDID': self.udid, 'FAKE_DEVICE_ROOT': str(self.devices),
            'FAKE_DELETED': str(self.root / 'deleted'), 'FAKE_WORKTREE': str(self.worktree.resolve()),
            'HOME': str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def retire(self, **kwargs):
        return retirement.retire(issue=self.issue, udid=self.udid, worktree=self.worktree,
            archive_root=self.archive, device_root=self.devices, claim_file=self.claim, **kwargs)

    def test_archives_raw_and_keeps_exported_proof_before_exact_device_delete(self):
        result = self.retire()
        self.assertTrue((self.root / 'deleted').exists())
        self.assertTrue(self.app.exists())
        self.assertTrue((self.flow / 'report.json').exists())
        self.assertEqual(len(result['attachments']), 1)
        raw = result['attachments'][0]
        self.assertEqual(Path(raw['archive']).read_bytes(), b'raw evidence')
        self.assertEqual(raw['sha256'], retirement.digest(Path(raw['archive'])))
        self.assertTrue((self.archive / self.udid / 'retired.json').exists())
        self.assertEqual(self.retire()['deletionOutcome'], 'simctl delete returned successfully')

    def modern_receipt(self):
        module = self.worktree / 'scripts/sim/native-identity.mjs'
        shutil.copy2(Path(__file__).with_name('native-identity.mjs'), module)
        (self.worktree / 'scripts/sim/product-flow.mjs').write_text('''import {createHash} from 'node:crypto';
export function environment() {
  const entries=Object.entries(process.env).filter(([key])=>key.startsWith('EXPO_PUBLIC_')).sort(([a],[b])=>a.localeCompare(b));
  return {configHash:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}
''')
        env_file = self.worktree / 'apps/mobile/.env.development.local'
        env_file.parent.mkdir(parents=True, exist_ok=True)
        env_file.write_text('EXPO_PUBLIC_POSTHOG_API_KEY=before\n')
        (self.worktree / '.gitignore').write_text('node_modules/\napps/mobile/.env.development.local\n')
        mocked = self.worktree / 'apps/mobile/__mocks__/fixture.ts'
        mocked.parent.mkdir(parents=True, exist_ok=True)
        mocked.write_text('mocked unit-test dependency')
        expo_cli = self.worktree / 'node_modules/expo/bin/cli'
        expo_cli.parent.mkdir(parents=True)
        expo_cli.write_text('process.stdout.write(JSON.stringify({name:"Fitsy",slug:"fitsy",ios:{},_internal:{modResults:{ios:{}}}}));')
        autolink = self.worktree / 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking'
        autolink.parent.mkdir(parents=True)
        autolink.write_text('process.stdout.write(JSON.stringify(process.argv[2]==="resolve"?{modules:[]}:{dependencies:{}}));')
        (self.worktree / 'package-lock.json').write_text(json.dumps({'packages': {
            'node_modules/expo': {'version': '54.0.0'},
            'node_modules/react-native': {'version': '0.81.0'}}}))
        build_file = self.worktree / '.evidence/product-build/receipt.json'
        report_file = self.flow / 'report.json'
        receipt, report = json.loads(build_file.read_text()), json.loads(report_file.read_text())
        receipt.pop('nativeSourceHash')
        report.pop('nativeSourceHash')
        receipt['jsHash'] = retirement.input_hash(self.worktree, mobile_only='js')
        receipt['configHash'] = retirement.current_public_config_hash(self.worktree)
        report['configHash'] = receipt['configHash']
        current_script = ('const {nativeIdentity}=await import(process.argv[1]); '
                          'process.stdout.write(JSON.stringify(nativeIdentity(process.argv[2],{...process.env,NODE_ENV:"production"})));')
        current_native = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', current_script,
            str(module), str(self.worktree)], text=True))
        identity_script = ('const {identityHash,sealReceipt}=await import(process.argv[1]); '
                           'const receipt=JSON.parse(process.argv[2]); '
                           'receipt.nativeIdentity=JSON.parse(process.argv[3]); '
                           'for(const key of ["profileIdentity","recipeIdentity"]) '
                           'receipt[key]={inputs:{fixture:key},hash:identityHash({fixture:key})}; '
                           'process.stdout.write(JSON.stringify(sealReceipt(receipt)));')
        receipt = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', identity_script,
            str(module), json.dumps(receipt), json.dumps(current_native)], text=True))
        build_file.write_text(json.dumps(receipt))
        for key in ('nativeIdentity', 'profileIdentity', 'recipeIdentity', 'jsHash'):
            report[key] = receipt[key]
        report['inputHash'] = retirement.input_hash(self.worktree, mobile_only='acceptance')
        report_file.write_text(json.dumps(report))

    def test_new_native_receipt_keeps_retirement_valid_after_unrelated_test_change(self):
        self.modern_receipt()
        (self.worktree / 'apps/mobile/lib').mkdir(parents=True, exist_ok=True)
        (self.worktree / 'apps/mobile/lib/new.test.ts').write_text('unrelated test-only split')
        result = self.retire()
        self.assertEqual(result['deletionOutcome'], 'simctl delete returned successfully')
        self.assertEqual(len(result['attachments']), 1)

    def test_new_native_receipt_allows_verified_artifact_from_compatible_simulator(self):
        self.modern_receipt()
        build_file = self.worktree / '.evidence/product-build/receipt.json'
        receipt = json.loads(build_file.read_text())
        receipt['simulator'] = 'A88FB95C-9CC6-41B8-A2BA-A68F3A5C4AF4'
        receipt.pop('receiptHash')
        module = self.worktree / 'scripts/sim/native-identity.mjs'
        sealed = subprocess.check_output(['node', '--input-type=module', '-e',
            'const {sealReceipt}=await import(process.argv[1]); process.stdout.write(JSON.stringify(sealReceipt(JSON.parse(process.argv[2]))));',
            str(module), json.dumps(receipt)], text=True)
        build_file.write_text(sealed)
        result = self.retire()
        self.assertEqual(result['deletionOutcome'], 'simctl delete returned successfully')
        self.assertEqual(json.loads(self.flow.joinpath('report.json').read_text())['simulator'], self.udid)

    def test_new_native_receipt_rejects_stale_embedded_javascript(self):
        self.modern_receipt()
        (self.worktree / 'apps/mobile/lib').mkdir(parents=True, exist_ok=True)
        (self.worktree / 'apps/mobile/lib/screen.ts').write_text('new JavaScript after Release proof')
        with self.assertRaisesRegex(ValueError, 'embedded JavaScript changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_new_native_receipt_rejects_changed_native_input(self):
        self.modern_receipt()
        native = self.worktree / 'apps/mobile/ios/Fitsy/Native.swift'
        native.parent.mkdir(parents=True, exist_ok=True)
        native.write_text('changed compiled native source')
        with self.assertRaisesRegex(ValueError, 'resolved native inputs changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_new_native_receipt_rejects_changed_public_environment(self):
        self.modern_receipt()
        (self.worktree / 'apps/mobile/.env.development.local').write_text('EXPO_PUBLIC_POSTHOG_API_KEY=after\n')
        with self.assertRaisesRegex(ValueError, 'public configuration changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_new_native_receipt_rejects_changed_acceptance_flow(self):
        self.modern_receipt()
        (self.worktree / 'apps/mobile/e2e/flows/cold-start-welcome.yaml').write_text('name: changed-flow\n')
        with self.assertRaisesRegex(ValueError, 'acceptance inputs changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_interrupted_delete_reconciles_verified_archive(self):
        original = retirement.command
        def interrupted(*args):
            result = original(*args)
            if args[:3] == ('xcrun', 'simctl', 'delete'):
                raise KeyboardInterrupt('process exited after delete')
            return result
        with mock.patch.object(retirement, 'command', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.retire()
        self.assertFalse((self.archive / self.udid / 'retired.json').exists())
        (self.worktree / 'apps/api').mkdir(parents=True)
        (self.worktree / 'apps/api/changed.ts').write_text('changed after deletion')
        result = self.retire()
        self.assertEqual(result['deletionOutcome'], 'observed absent after durable intent')
        self.assertTrue((self.archive / self.udid / 'retired.json').exists())
        self.assertEqual(len(result['proof']), 2)

    def test_partial_predelete_archive_resumes(self):
        original = retirement.durable_json
        def interrupted(path, value):
            if path.name == 'mapping.json':
                raise KeyboardInterrupt('interrupted before mapping')
            return original(path, value)
        with mock.patch.object(retirement, 'durable_json', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.retire()
        destination = self.archive / self.udid / self.attachment.relative_to(self.devices / self.udid)
        self.assertTrue(destination.is_file())
        self.assertFalse((self.archive / self.udid / 'mapping.json').exists())
        destination.write_bytes(b'partial copy')
        self.assertTrue(self.retire()['deleted'])
        self.assertEqual(destination.read_bytes(), b'raw evidence')

    def test_repeat_rejects_corrupted_archived_report(self):
        self.retire()
        archived = self.archive / self.udid / 'proof/product-flow-report.json'
        archived.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'archived proof digest differs'):
            self.retire()

    def test_claim_waits_for_shared_retirement_lock(self):
        lock_file = self.claim.with_suffix('.lock')
        lock_file.touch()
        with lock_file.open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            script = Path(__file__).parent / 'sim'
            child = subprocess.Popen([str(script), 'claim', '--minutes', '1'],
                                     env={**os.environ, 'FITSY_SIM_OWNER': 'new-owner'},
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            time.sleep(0.25)
            self.assertIsNone(child.poll(), 'claim passed the retirement lock')
            fcntl.flock(lock, fcntl.LOCK_UN)
            output, error = child.communicate(timeout=5)
        self.assertEqual(child.returncode, 0, error)
        self.assertEqual(json.loads(output)['status'], 'pass')

    def test_delete_holds_shared_retirement_lock(self):
        original = retirement.command
        def checked(*args):
            if args[:3] == ('xcrun', 'simctl', 'delete'):
                probe = subprocess.run([sys.executable, '-c',
                    'import fcntl,sys; f=open(sys.argv[1], "r+"); '
                    'fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)',
                    str(self.claim.with_suffix('.lock'))], capture_output=True)
                self.assertNotEqual(probe.returncode, 0, 'delete did not hold shared lock')
            return original(*args)
        with mock.patch.object(retirement, 'command', side_effect=checked):
            self.retire()

    def test_active_claim_and_unverified_receipt_hold_device(self):
        self.claim.write_text(json.dumps({'owner': 'current', 'expires': 9999999999}))
        with self.assertRaisesRegex(ValueError, 'active owner'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())
        self.claim.unlink()
        report = json.loads((self.flow / 'report.json').read_text())
        report['result'] = 'fail'
        (self.flow / 'report.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'passing product-flow'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_name_only_or_unverified_artifact_never_deletes(self):
        with mock.patch.dict(os.environ, {'FAKE_DEVICE_NAME': 'Fitsy-Issue-414'}):
            with self.assertRaisesRegex(ValueError, 'name does not match'):
                self.retire()
        (self.flow / 'cold-start-welcome-outcome.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'receipt file missing or changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_booted_device_is_retained(self):
        with mock.patch.dict(os.environ, {'FAKE_DEVICE_STATE': 'Booted'}):
            with self.assertRaisesRegex(ValueError, 'not shut down'):
                self.retire()
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())

    def test_list_omission_while_directory_exists_is_retryable(self):
        with mock.patch.dict(os.environ, {'FAKE_HIDE_DEVICE': '1'}):
            with self.assertRaisesRegex(ValueError, 'directory still exists'):
                self.retire()
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())
        self.assertTrue(self.retire()['deleted'])

    def test_process_with_only_checkout_cwd_retains_device(self):
        with mock.patch.dict(os.environ, {'FAKE_LSOF_CHECKOUT': '1'}):
            with self.assertRaisesRegex(ValueError, 'checkout has an active process'):
                self.retire()
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())

    def test_hashed_but_empty_assertions_and_non_png_hold_device(self):
        report_file = self.flow / 'report.json'
        report = json.loads(report_file.read_text())
        commands = self.flow / report['flows'][0]['commands']
        commands.write_text('[]')
        report['flows'][0]['sha256'] = retirement.digest(commands)
        report_file.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'empty product-flow command report'):
            self.retire()
        commands.write_text(json.dumps([
            {'command': {'applyConfigurationCommand': {'config': {'appId': 'com.fitsy.mobile'}}},
             'metadata': {'status': 'COMPLETED'}},
            {'command': {'assertConditionCommand': {'optional': False}}, 'metadata': {'status': 'COMPLETED'}}]))
        report['flows'][0]['sha256'] = retirement.digest(commands)
        screenshot = self.flow / report['flows'][0]['screenshot']
        screenshot.write_bytes(b'not-png')
        report['flows'][0]['screenshotHash'] = retirement.digest(screenshot)
        report_file.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'not PNG'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_late_raw_attachment_is_retained_with_device(self):
        original = retirement.idle
        calls = 0
        def late(*args):
            nonlocal calls
            original(*args)
            calls += 1
            if calls == 2:
                (self.attachment.parent / 'late-raw').write_bytes(b'late evidence')
        with mock.patch.object(retirement, 'idle', side_effect=late):
            with self.assertRaisesRegex(ValueError, 'inventory changed'):
                self.retire()
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())

    def test_reopened_issue_at_final_boundary_retains_device(self):
        with self.assertRaisesRegex(ValueError, 'no longer terminal-verified'):
            self.retire(confirm_verified=lambda: False)
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())

    def test_verified_empty_attachment_inventory_retires_device(self):
        self.attachment.unlink()
        result = self.retire()
        self.assertEqual(result['attachments'], [])
        self.assertTrue((self.root / 'deleted').exists())

    def test_missing_internal_daemon_is_valid_empty_inventory(self):
        shutil.rmtree(self.attachment.parents[2])
        result = self.retire()
        self.assertEqual(result['attachments'], [])
        self.assertTrue((self.root / 'deleted').exists())

    def test_stale_full_source_with_unchanged_app_retains_device(self):
        source = self.worktree / 'apps/api/changed.ts'
        source.parent.mkdir(parents=True)
        source.write_text('export const changed = true;')
        with self.assertRaisesRegex(ValueError, 'source or build identity is stale'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_metro_dependent_test_store_app_retains_device(self):
        receipt_file = self.worktree / '.evidence/product-build/receipt.json'
        report_file = self.flow / 'report.json'
        receipt, report = json.loads(receipt_file.read_text()), json.loads(report_file.read_text())
        for item in (receipt, report):
            item.update({'buildMode': 'owned-metro-test-store', 'configuration': 'Debug', 'storeMode': 'test-store'})
        receipt_file.write_text(json.dumps(receipt))
        report_file.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, 'not a compatible retained export'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())


if __name__ == '__main__':
    unittest.main()
