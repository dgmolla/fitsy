import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('advisory', Path(__file__).with_name('advisory-finding.py'))
advisory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(advisory)


def fixture(priority='P2'):
    return {'raw': {'verdict': 'fail', 'priority': priority, 'head': 'a' * 40,
                    'source': 'https://example.test/review', 'finding': 'A current defect'},
            'context': 'Changed line and relevant context', 'evidence': 'Independent reproduction',
            'urgency_rubric': 'P1 is high material impact; P2 is medium.',
            'acceptance_criteria': [{'id': 'A1', 'text': 'The flow completes', 'source': 'https://example.test/acceptance'}],
            'owner': 'Infrastructure', 'followup': 'https://example.test/issue/2'}


def response(value, disposition, criterion='A1', confidence=.9):
    choices = {'disposition': disposition, 'reason': 'acceptance', 'criterion': criterion}
    answers = {}
    for name, question in advisory.questions(value).items():
        options = question['criteria']
        other = (1 - confidence) / (len(options) - 1)
        answers[name] = {'choice': choices[name], 'confidence': confidence,
                         'probabilities': {key: confidence if key == choices[name] else other for key in options}}
    return {'answers': answers, 'model': 'fixture', 'usage': {'input_tokens': 1000}}, 'jev-latest'


class AdvisoryTests(unittest.TestCase):
    def test_schema_rejects_unbounded_and_stale_identity(self):
        value = fixture()
        value['context'] = 'x' * 6001
        with self.assertRaises(ValueError):
            advisory.validate(value)
        value = fixture()
        value['raw']['head'] = 'short'
        with self.assertRaises(ValueError):
            advisory.validate(value)

    def test_provider_failure_is_explicit_and_preserves_raw(self):
        value = fixture()
        def fail(*_):
            raise TimeoutError('secret diagnostic')
        result = advisory.recommend(value, {}, fail)
        self.assertEqual((result['status'], result['recommendation'], result['fallback']),
                         ('unavailable', 'investigate', 'existing_source_bound_review_policy'))
        self.assertEqual(result['provenance']['raw_priority'], 'P2')
        self.assertNotIn('secret diagnostic', str(result))

    def test_high_impact_never_defers_and_fix_requires_criterion(self):
        value = fixture('P1')
        result = advisory.recommend(value, {}, lambda *_: response(value, 'defer_with_owner'))
        self.assertEqual(result['recommendation'], 'investigate')
        value = fixture()
        result = advisory.recommend(value, {}, lambda *_: response(value, 'fix_now', 'none'))
        self.assertEqual(result['recommendation'], 'investigate')

    def test_owned_deferral_and_cost(self):
        value = fixture()
        result = advisory.recommend(value, {'usd_per_million_input_tokens': .042},
                                    lambda *_: response(value, 'defer_with_owner'))
        self.assertEqual(result['recommendation'], 'defer_with_owner')
        self.assertEqual(result['owner'], 'Infrastructure')
        self.assertIsNone(result['cost_usd'])
        self.assertEqual(result['estimated_cost_usd'], .000042)
        self.assertEqual(result['provenance']['raw_verdict'], 'fail')

    def test_uncertainty_is_investigate(self):
        value = fixture()
        result = advisory.recommend(value, {}, lambda *_: response(value, 'likely_unsupported', confidence=.5))
        self.assertEqual(result['recommendation'], 'investigate')


if __name__ == '__main__':
    unittest.main()
