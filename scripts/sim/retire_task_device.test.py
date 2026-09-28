"""Actual disposable simctl boundary for verified task-device retirement."""

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
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
        self.app = self.worktree / '.evidence/product-build/Build/Products/Debug-iphonesimulator/Fitsy.app'
        self.app.mkdir(parents=True)
        (self.app / 'main.jsbundle').write_text('exported app')
        self.flow = self.worktree / '.evidence/product-flow'
        self.flow.mkdir(parents=True)
        for name, data in [('commands.json', b'[]'), ('outcome.png', b'png'),
                           ('capture.jsonl', b'{}\n'), ('closeout.json', b'{}'),
                           ('mcp.jsonl', b'{}\n')]:
            (self.flow / name).write_bytes(data)
        flow = {'commands': 'commands.json', 'sha256': retirement.digest(self.flow / 'commands.json'),
                'screenshot': 'outcome.png', 'screenshotHash': retirement.digest(self.flow / 'outcome.png'),
                'captureReceipt': 'capture.jsonl', 'captureReceiptHash': retirement.digest(self.flow / 'capture.jsonl'),
                'attachmentCloseout': 'closeout.json', 'attachmentCloseoutHash': retirement.digest(self.flow / 'closeout.json')}
        (self.flow / 'report.json').write_text(json.dumps({'simulator': self.udid, 'result': 'pass',
            'appHash': retirement.app_hash(self.app), 'flows': [flow],
            'exploration': [{'trace': 'mcp.jsonl', 'sha256': retirement.digest(self.flow / 'mcp.jsonl')}]}))
        (self.worktree / '.evidence/product-build/receipt.json').write_text(json.dumps({
            'simulator': self.udid, 'app': str(self.app), 'appHash': retirement.app_hash(self.app)}))
        self.devices = self.root / 'devices'
        self.attachment = self.devices / self.udid / 'data/Containers/Data/InternalDaemon/owner/Attachments/raw-without-extension'
        self.attachment.parent.mkdir(parents=True)
        self.attachment.write_bytes(b'raw evidence')
        self.archive = self.root / 'archive'
        self.claim = self.root / 'claim.json'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        xcrun = self.bin / 'xcrun'
        xcrun.write_text('''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
udid=os.environ['FAKE_UDID']; root=Path(os.environ['FAKE_DEVICE_ROOT'])
if sys.argv[1:3] == ['simctl','list']:
 present=(root/udid).exists()
 print(json.dumps({'devices': {'iOS': [{'udid':udid,'name':os.environ.get('FAKE_DEVICE_NAME','Fitsy-Issue-412'),'state':os.environ.get('FAKE_DEVICE_STATE','Shutdown')}] if present else []}}))
elif sys.argv[1:3] == ['simctl','delete']:
 shutil.rmtree(root/udid); Path(os.environ['FAKE_DELETED']).write_text(udid)
else: raise SystemExit(2)
''')
        xcrun.chmod(0o700)
        for name in ('ps', 'lsof'):
            binary = self.bin / name
            binary.write_text('#!/bin/sh\nexit 1\n' if name == 'lsof' else '#!/bin/sh\nexit 0\n')
            binary.chmod(0o700)
        self.env = mock.patch.dict(os.environ, {'PATH': str(self.bin) + ':' + os.environ['PATH'],
            'FAKE_UDID': self.udid, 'FAKE_DEVICE_ROOT': str(self.devices),
            'FAKE_DELETED': str(self.root / 'deleted')})
        self.env.start()
        self.addCleanup(self.env.stop)

    def retire(self):
        return retirement.retire(issue=self.issue, udid=self.udid, worktree=self.worktree,
            archive_root=self.archive, device_root=self.devices, claim_file=self.claim)

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
        result = self.retire()
        self.assertEqual(result['deletionOutcome'], 'observed absent after durable intent')
        self.assertTrue((self.archive / self.udid / 'retired.json').exists())

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
        (self.flow / 'outcome.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'receipt file missing or changed'):
            self.retire()
        self.assertFalse((self.root / 'deleted').exists())

    def test_booted_device_is_retained(self):
        with mock.patch.dict(os.environ, {'FAKE_DEVICE_STATE': 'Booted'}):
            with self.assertRaisesRegex(ValueError, 'not shut down'):
                self.retire()
        self.assertTrue(self.attachment.exists())
        self.assertFalse((self.root / 'deleted').exists())


if __name__ == '__main__':
    unittest.main()
