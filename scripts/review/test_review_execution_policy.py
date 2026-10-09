import unittest, tempfile, pathlib, json, subprocess, time, hashlib, importlib.util, os
script=pathlib.Path(__file__).with_name('review-budget.py')
spec=importlib.util.spec_from_file_location('budget',script); budget=importlib.util.module_from_spec(spec); spec.loader.exec_module(budget)
class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.temp.name)
        self.ledger=self.root/'issue-443.jsonl'; self.policy=self.root/'policy.json'
        self.events=[{'event':'start','attempt_id':'old','round_id':'old','lens':'review-round','source_sha':'a'*40,'epoch':time.time()-100}, {'event':'finish','attempt_id':'old','round_id':'old','lens':'review-round','source_sha':'a'*40,'elapsed_seconds':100,'outcome':'pass','verdict':'fail','failure_kind':'completed'}]
        self.save()
        self.manifest={'issue':443,'candidate':'root:branch','seconds':300,'baseline':{'old':hashlib.sha256(json.dumps(self.events,sort_keys=True).encode()).hexdigest()},'provenance':'https://github.com/dgmolla/fitsy/issues/443#issuecomment-6074155083'}
        self.save_policy()
    def tearDown(self): self.temp.cleanup()
    def save(self): self.ledger.write_text(''.join(json.dumps(e)+'\n' for e in self.events))
    def save_policy(self): self.policy.write_text(json.dumps(self.manifest)); self.policy.chmod(0o600)
    def call(self,action='begin',id='new',extra=(),policy=True):
        args=['python3','-I',str(script),action,'--ledger',str(self.ledger),'--candidate','root:branch','--issue','443','--risk','medium','--required','--round-id',id,'--attempt-id',id,'--lens','review-round','--source-sha','b'*40,'--timeout-seconds','300']
        if policy: args+=['--execution-policy',str(self.policy)]
        result=subprocess.run(args+list(extra),capture_output=True,text=True)
        return result.returncode,json.loads(result.stdout)
    def test_legacy_floor_still_denies_without_policy(self):
        before=self.ledger.read_bytes(); code,value=self.call(policy=False)
        self.assertEqual(code,1); self.assertEqual(value['required_window_seconds'],900); self.assertEqual(before,self.ledger.read_bytes())
    def test_short_admission_retains_raw_failure_and_reserves_closeout(self):
        before=self.ledger.read_text(); code,value=self.call()
        self.assertEqual(code,0); self.assertEqual(value['timeout_seconds'],295); self.assertEqual(value['reservation_seconds'],300)
        self.assertTrue(self.ledger.read_text().startswith(before)); self.assertEqual(value['review_verdicts']['fail'],1)
    def test_successor_uses_cumulative_remainder(self):
        self.events += [{'event':'start','attempt_id':'next','round_id':'next','lens':'review-round','source_sha':'b'*40,'epoch':time.time()-125},{'event':'finish','attempt_id':'next','round_id':'next','lens':'review-round','source_sha':'b'*40,'elapsed_seconds':125,'outcome':'pass','verdict':'fail','failure_kind':'completed'}]; self.save()
        code,value=self.call(id='successor'); self.assertEqual(code,0); self.assertEqual(value['timeout_seconds'],170); self.assertEqual(value['prospective_completed_seconds'],125)
    def test_unfinished_attempt_denied_without_mutation(self):
        self.assertEqual(self.call()[0],0); before=self.ledger.read_bytes()
        self.assertEqual(self.call(id='second')[0],1); self.assertEqual(before,self.ledger.read_bytes())
    def test_closeout_preserves_incomplete_and_releases_reservation(self):
        self.assertEqual(self.call()[0],0)
        code,value=self.call('finish',extra=('--outcome','fail','--verdict','incomplete','--failure-kind','timeout'))
        self.assertEqual(code,0)
        code,value=self.call('status'); self.assertEqual(code,0); self.assertEqual(value['reserved_seconds'],0); self.assertEqual(value['review_verdicts']['incomplete'],1); self.assertGreater(value['prospective_completed_seconds'],0)
        before=self.ledger.read_bytes(); self.assertEqual(self.call(id='retry')[0],1); self.assertEqual(before,self.ledger.read_bytes())
    def test_exhausted_policy_denies(self):
        self.events += [{'event':'start','attempt_id':'next','round_id':'next','lens':'review-round','source_sha':'b'*40,'epoch':time.time()-300},{'event':'finish','attempt_id':'next','round_id':'next','lens':'review-round','source_sha':'b'*40,'elapsed_seconds':300,'outcome':'pass','verdict':'fail','failure_kind':'completed'}]; self.save()
        before=self.ledger.read_bytes(); code,value=self.call(); self.assertEqual(code,1); self.assertEqual(value['prospective_remaining_seconds'],0); self.assertEqual(before,self.ledger.read_bytes())
    def test_changed_baseline_denied(self):
        self.events[1]['elapsed_seconds']=99; self.save(); self.assertEqual(self.call()[0],1)
    def test_missing_baseline_denied(self):
        self.manifest['baseline']['missing']='a'*64; self.save_policy(); self.assertEqual(self.call()[0],1)
    def test_wrong_issue_candidate_or_extra_schema_denied(self):
        for key,value in [('issue',442),('candidate','root:other'),('seconds',301),('unexpected',True)]:
            saved=dict(self.manifest); self.manifest[key]=value; self.save_policy(); self.assertEqual(self.call()[0],1); self.manifest=saved
    def test_nonprivate_policy_denied(self):
        self.policy.chmod(0o644); self.assertEqual(self.call()[0],1)
    def test_git_contained_policy_denied(self):
        subprocess.run(['git','init','-q',str(self.root)],check=True); self.assertEqual(self.call()[0],1)
    def test_extensions_and_grants_denied_without_ledger_change(self):
        for action in ['extend','grant-authorized']:
            before=self.ledger.read_bytes(); self.assertEqual(self.call(action)[0],1); self.assertEqual(before,self.ledger.read_bytes())
if __name__=='__main__': unittest.main(verbosity=2)
