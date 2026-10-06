import importlib.util
import json
import os
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone


spec = importlib.util.spec_from_file_location('local_report', Path(__file__).with_name('local-report.py'))
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)


def epoch(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


class Slack:
    def __init__(self, history=None, error=None):
        self.history = history or []
        self.error = error
        self.posts = []

    def call(self, method, params=None, payload=None):
        if self.error:
            raise self.error
        if method == 'conversations.history':
            return {'ok': True, 'messages': self.history}
        self.posts.append(payload)
        return {'ok': True, 'channel': payload['channel'], 'ts': '123.456'}


class LocalReportTest(unittest.TestCase):
    def test_actual_canonical_snapshot_command_defers_publisher_without_second_slot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / 'runtime'; runtime.mkdir()
            counter = root / 'calls'
            (runtime / 'local-dispatcher.py').write_text(
                "from pathlib import Path\nimport json,sys\n"
                f"Path({str(counter)!r}).write_text('snapshot')\n"
                "assert sys.argv[1] == 'snapshot'\n"
                "print(json.dumps({'state':'queue-read-backoff','retry_at':'2026-09-27T05:00:00Z'}))\n")
            now = epoch('2026-09-27T04:35:00Z')
            config = {'channel':'C123','user':'U123','activated_at':now-3600}
            slack = Slack()
            with patch.dict(os.environ, {'FITSY_DISPATCHER_CONFIG':str(root / 'config.json')}):
                reporter.run_once(config, root, slack, now=now)
            self.assertEqual(counter.read_text(), 'snapshot')
            receipts = list((root / 'slots').glob('*.json'))
            self.assertEqual(len(receipts), 1)
            self.assertEqual(json.loads(receipts[0].read_text())['next_attempt'], epoch('2026-09-27T05:00:00Z'))
            self.assertEqual(slack.posts, [])

    def test_editorial_bindings_still_require_current_status_and_fresh_authorship(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            now = epoch('2026-09-27T04:35:00Z')
            update = {'authored_at':'2026-09-27T04:30:00Z',
                      'bullets':['Feature repair underway.', 'Acceptance pending.', 'Next: exact source review.'],
                      'board_bindings':{'443':'In flight'}}
            reporter.save(state / 'editorial-update.json', update)
            report = {'editorialFacts':[{'number':443,'status':'In flight','title':'Feature repair'}]}
            reporter.compose_update(report, state, '2026-09-27T04:30', now)
            self.assertEqual(report['editorial']['state'], 'fresh')
            report['editorialFacts'][0]['status'] = 'Queued'
            reporter.compose_update(report, state, '2026-09-27T04:30', now)
            self.assertEqual(report['editorial']['state'], 'fallback')

    def test_malformed_optional_editorial_still_delivers_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            now = epoch('2026-09-27T04:35:00Z')
            for malformed in ({'authored_at':0}, {'authored_at':'2026-09-27T04:30:00Z',
                    'bullets':['One.','Two.','Three.'],'board_bindings':[]}):
                reporter.save(state / 'editorial-update.json', malformed)
                report = {'editorialFacts':[]}
                message = reporter.compose_update(report, state, '2026-09-27T04:30', now)
                self.assertEqual(report['editorial']['state'], 'fallback')
                self.assertIn('No delivery worker', message)

    def test_dependency_fallback_does_not_claim_completed_dependencies_block_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            report = {'editorialFacts':[{'number':443,'status':'Queued','title':'Feature repair',
                       'dependencies':'#442','blocker':'','held':False}]}
            message = reporter.compose_update(report, Path(temporary), '2026-09-27T04:30')
            self.assertNotIn('waiting on recorded holds or dependencies', message)
            self.assertIn('eligibility', message)

    def test_history_pagination_and_legacy_marker_prevent_a_second_post(self):
        class PagedSlack(Slack):
            def call(self, method, params=None, payload=None):
                if method == 'conversations.history':
                    if not params.get('cursor'):
                        return {'ok': True, 'messages': [],
                                'response_metadata': {'next_cursor': 'page2'}}
                    return {'ok': True, 'messages': [{'text': 'old fitsy-hour:2026-09-27T03',
                                                       'ts': str(epoch('2026-09-27T03:40:00Z')), 'user': 'U123'}]}
                return super().call(method, params, payload)
        slack = PagedSlack()
        first = reporter.post_once(slack, 'C123', '2026-09-27T03:30', 'new report', 'U123')
        self.assertEqual(first['state'], 'scanning')
        receipt = reporter.post_once(slack, 'C123', '2026-09-27T03:30', 'new report', 'U123',
                                     first['cursor'], first['seen'])
        self.assertTrue(receipt['duplicate'])
        self.assertEqual(receipt['ts'], str(epoch('2026-09-27T03:40:00Z')))
        self.assertEqual(slack.posts, [])

    def test_legacy_marker_in_next_half_hour_does_not_suppress_slot(self):
        slack = Slack([{'text': 'fitsy-hour:2026-09-27T03',
                        'ts': str(epoch('2026-09-27T03:45:00Z')), 'user': 'U123'}])
        receipt = reporter.post_once(slack, 'C123', '2026-09-27T03:00',
                                     'fitsy-slot:2026-09-27T03:00', 'U123')
        self.assertFalse(receipt['duplicate'])
        self.assertEqual(len(slack.posts), 1)

    def test_matching_marker_from_another_sender_does_not_suppress_delivery(self):
        slack = Slack([{'text': 'fitsy-slot:2026-09-27T03:30',
                        'ts': str(epoch('2026-09-27T03:32:00Z')), 'user': 'U_OTHER'}])
        receipt = reporter.post_once(slack, 'C123', '2026-09-27T03:30',
                                     'fitsy-slot:2026-09-27T03:30 real report', 'U123')
        self.assertFalse(receipt['duplicate'])
        self.assertEqual(len(slack.posts), 1)

    def test_pagination_cursor_survives_between_timer_wakes(self):
        class PagedSlack(Slack):
            def __init__(self):
                super().__init__()
                self.cursors = []

            def call(self, method, params=None, payload=None):
                if method == 'conversations.history':
                    cursor = params.get('cursor', '')
                    self.cursors.append(cursor)
                    if not cursor:
                        return {'messages': [], 'response_metadata': {'next_cursor': 'page2'}}
                    return {'messages': [{'text': 'fitsy-slot:2026-09-27T03:30', 'ts': '123.456', 'user': 'U123'}]}
                return super().call(method, params, payload)

        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            slack = PagedSlack()
            generate = lambda _runtime, _state, slot, _roots: f'fitsy-slot:{slot}'
            reporter.run_once(config, state, slack, start + 120, generate)
            pending = json.loads(next((state / 'slots').glob('*.json')).read_text())
            self.assertEqual(pending['cursor'], 'page2')
            reporter.run_once(config, state, slack, start + 180, generate)
            self.assertEqual(slack.cursors, ['', 'page2'])
            self.assertEqual(slack.posts, [])
            self.assertTrue(json.loads(next((state / 'slots').glob('*.json')).read_text())['duplicate'])

    def test_uncertain_post_receipt_restarts_history_from_first_page(self):
        class UncertainSlack(Slack):
            def __init__(self):
                super().__init__()
                self.cursors = []

            def call(self, method, params=None, payload=None):
                if method == 'conversations.history':
                    cursor = params.get('cursor', '')
                    self.cursors.append(cursor)
                    if len(self.cursors) == 3:
                        return {'messages': [{'text': 'fitsy-slot:2026-09-27T03:30', 'ts': '123.456', 'user': 'U123'}]}
                    return {'messages': [], 'response_metadata':
                            {'next_cursor': 'page2' if not cursor else ''}}
                return {'channel': 'C123', 'user': 'U123'}  # Slack accepted the post but its receipt lost ts.

        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            slack = UncertainSlack()
            generate = lambda _runtime, _state, slot, _roots: f'fitsy-slot:{slot}'
            for offset in (120, 180, 240):
                reporter.run_once(config, state, slack, start + offset, generate)
            self.assertEqual(slack.cursors, ['', 'page2', ''])
            self.assertTrue(json.loads(next((state / 'slots').glob('*.json')).read_text())['duplicate'])

    def test_uncertain_post_retry_reuses_client_message_id(self):
        class UncertainSlack(Slack):
            def call(self, method, params=None, payload=None):
                if method == 'conversations.history':
                    return {'messages': []}
                self.posts.append(payload)
                return {'channel': 'C123', **({'ts': '123.456'} if len(self.posts) == 2 else {})}

        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            slack = UncertainSlack()
            generate = lambda _runtime, _state, slot, _roots: f'fitsy-slot:{slot}'
            reporter.run_once(config, state, slack, start + 120, generate)
            reporter.run_once(config, state, slack, start + 180, generate)
            self.assertEqual(len(slack.posts), 2)
            self.assertTrue(slack.posts[0]['client_msg_id'])
            self.assertEqual(slack.posts[0]['client_msg_id'], slack.posts[1]['client_msg_id'])

    def test_crash_after_paged_post_restarts_history_at_first_page(self):
        class CrashSlack(Slack):
            def __init__(self):
                super().__init__()
                self.cursors = []

            def call(self, method, params=None, payload=None):
                if method == 'conversations.history':
                    cursor = params.get('cursor', '')
                    self.cursors.append(cursor)
                    if len(self.cursors) == 3:
                        return {'messages': [{'text': self.posts[0]['text'], 'ts': '123.456', 'user': 'U123'}]}
                    return {'messages': [], 'response_metadata':
                            {'next_cursor': 'page2' if not cursor else ''}}
                self.posts.append(payload)
                raise SystemExit('process stopped after Slack accepted the post')

        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            slack = CrashSlack()
            generate = lambda _runtime, _state, slot, _roots: f'fitsy-slot:{slot}'
            reporter.run_once(config, state, slack, start + 120, generate)
            with self.assertRaises(SystemExit):
                reporter.run_once(config, state, slack, start + 180, generate)
            pending = json.loads(next((state / 'slots').glob('*.json')).read_text())
            self.assertEqual(pending['state'], 'pending')
            self.assertNotIn('cursor', pending)
            reporter.run_once(config, state, slack, start + 240, generate)
            self.assertEqual(slack.cursors, ['', 'page2', ''])
            self.assertEqual(len(slack.posts), 1)
            self.assertTrue(json.loads(next((state / 'slots').glob('*.json')).read_text())['duplicate'])

    def test_half_hour_due_slots_and_activation_boundary(self):
        activated = epoch('2026-09-27T03:30:00Z')
        self.assertEqual(reporter.due_slots(epoch('2026-09-27T03:31:59Z'), activated), [])
        self.assertEqual(reporter.due_slots(epoch('2026-09-27T03:32:00Z'), activated), [activated])
        self.assertEqual(reporter.due_slots(epoch('2026-09-27T04:02:00Z'), activated),
                         [activated, epoch('2026-09-27T04:00:00Z')])
        self.assertEqual(reporter.due_slots(epoch('2026-09-27T05:02:00Z'), activated),
                         [epoch('2026-09-27T04:30:00Z'), epoch('2026-09-27T05:00:00Z')])

    def test_one_receipt_per_slot_and_history_reconciles_uncertain_post(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            calls = []
            def generate(_runtime, _state, slot, _roots):
                calls.append(slot)
                return f'Fitsy report fitsy-slot:{slot}'
            slack = Slack()
            reporter.run_once(config, state, slack, start + 120, generate)
            reporter.run_once(config, state, slack, start + 180, generate)
            self.assertEqual(len(slack.posts), 1)
            self.assertEqual(len(calls), 1)
            receipt = json.loads(next((state / 'slots').glob('*.json')).read_text())
            self.assertEqual(receipt['ts'], '123.456')
            (state / 'slots' / '2026-09-27T03-30.json').unlink()
            recovering = Slack([{'text': slack.posts[0]['text'], 'ts': '123.456', 'user': 'U123'}])
            reporter.run_once(config, state, recovering, start + 240, generate)
            self.assertEqual(recovering.posts, [])
            self.assertTrue(json.loads(next((state / 'slots').glob('*.json')).read_text())['duplicate'])

    def test_shared_limiter_retry_time_stops_the_tick(self):
        class Backoff(Exception):
            retry_at = epoch('2026-09-27T04:10:00Z')
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            start = epoch('2026-09-27T03:30:00Z')
            config = {'activated_at': start, 'channel': 'C123', 'user': 'U123'}
            calls = []
            def generate(_runtime, _state, slot, _roots):
                calls.append(slot)
                return f'fitsy-slot:{slot}'
            reporter.run_once(config, state, Slack(error=Backoff('backoff')),
                              epoch('2026-09-27T04:02:00Z'), generate)
            self.assertEqual(calls, ['2026-09-27T03:30'])
            receipt = json.loads(next((state / 'slots').glob('*.json')).read_text())
            self.assertEqual(receipt['next_attempt'], Backoff.retry_at)
            reporter.run_once(config, state, Slack(), epoch('2026-09-27T04:03:00Z'), generate)
            self.assertEqual(calls, ['2026-09-27T03:30', '2026-09-27T04:00'])


if __name__ == '__main__':
    unittest.main()
