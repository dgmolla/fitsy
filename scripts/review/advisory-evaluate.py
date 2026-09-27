#!/usr/bin/env python3
"""Run the frozen #372 shadow cases without exposing the oracle to the classifier."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / 'scripts/review/fixtures/advisory-cases.json'
ORACLE = ROOT / 'scripts/review/fixtures/advisory-oracle.json'
EXPECTED_CASES_SHA256 = '227a7a80004e41ea19b95ea220414d72d1d4a677b9a337cb72cd28c3be1fd836'
EXPECTED_ORACLE_SHA256 = 'f91ba40b84ab935fce2200f697283b387edb6fa6de7f9f79a14ccb71d0d9061c'
SHADOW_OWNER = 'Shadow candidate owner'
SHADOW_FOLLOWUP = 'https://example.invalid/shadow-followup'


def read_frozen(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f'frozen fixture changed: {path}')
    return json.loads(data)


def validate_case_inputs(cases):
    if any('owner' in case or 'followup' in case for case in cases):
        raise ValueError('shadow cases must not expose historical owner or follow-up outcomes')


def shadow_input(case):
    return {**case, 'owner': SHADOW_OWNER, 'followup': SHADOW_FOLLOWUP}


def main():
    cases = read_frozen(CASES, EXPECTED_CASES_SHA256)['cases']
    oracle = {x['id']: x for x in read_frozen(ORACLE, EXPECTED_ORACLE_SHA256)['cases']}
    validate_case_inputs(cases)
    spec = importlib.util.spec_from_file_location('advisory', Path(__file__).with_name('advisory-finding.py'))
    advisory = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(advisory)
    config = {'key_file': str(Path.home() / '.fitsy-dispatcher/credentials/jev.env'),
              'usd_per_million_input_tokens': .042}
    outputs = []
    for case in cases:
        # Offer the same synthetic deferral plan for every case, independently
        # of the historical outcome. It never authorizes a real disposition.
        result = advisory.recommend(shadow_input(case), config)
        outputs.append({'id': case['id'], 'result': result})
    scored = []
    for row in outputs:
        expected = oracle[row['id']]['expected']
        result = row['result']
        scored.append({'id': row['id'], 'expected': expected, 'recommendation': result['recommendation'],
                       'confidence': result['confidence'], 'match': result['recommendation'] == expected,
                       'provider_disposition': result.get('provider_disposition'),
                       'provider_confidence': result.get('provider_confidence'),
                       'historical': oracle[row['id']]['basis'].startswith(('Prior', 'Historical'))})
    historical = [x for x in scored if x['historical']]
    blockers = [x for x in historical if x['expected'] == 'fix_now']
    known = [x for x in scored if x['provider_confidence'] is not None]
    known_costs = [x['result']['cost_usd'] for x in outputs if x['result']['cost_usd'] is not None]
    metrics = {'cases': len(scored), 'historical_cases': len(historical),
               'matches': sum(x['match'] for x in scored), 'disagreements': [x['id'] for x in scored if not x['match']],
               'missed_blockers': [x['id'] for x in blockers if x['recommendation'] != 'fix_now'],
               'false_deferrals': [x['id'] for x in blockers if x['recommendation'] == 'defer_with_owner'],
               'provider_false_deferrals': [x['id'] for x in blockers if x['provider_disposition'] == 'defer_with_owner'],
               'unnecessary_blockers': [x['id'] for x in scored if x['recommendation'] == 'fix_now' and x['expected'] != 'fix_now'],
               'provider_confidence_mean_correct': round(sum(x['provider_confidence'] for x in known if x['provider_disposition'] == x['expected']) / max(1, sum(x['provider_disposition'] == x['expected'] for x in known)), 3),
               'provider_confidence_mean_wrong': round(sum(x['provider_confidence'] for x in known if x['provider_disposition'] != x['expected']) / max(1, sum(x['provider_disposition'] != x['expected'] for x in known)), 3),
               'provider_choice_brier': round(sum((x['provider_confidence'] - int(x['provider_disposition'] == x['expected'])) ** 2 for x in known) / max(1, len(known)), 4),
               'latency_ms_total': sum(x['result']['latency_ms'] for x in outputs),
               'cost_usd_actual_observed': round(sum(known_costs), 8) if known_costs else None,
               'cost_unknown_count': sum(x['result']['cost_usd'] is None for x in outputs),
               'cost_usd_list_price_estimate': round(sum(x['result']['estimated_cost_usd'] or 0 for x in outputs), 8)}
    receipt = {'version': 1, 'at': datetime.now(timezone.utc).isoformat(),
               'cases_sha256': EXPECTED_CASES_SHA256, 'oracle_sha256': EXPECTED_ORACLE_SHA256,
               'pricing': {'usd_per_million_input_tokens': .042, 'source': 'https://typesafe.ai/blog/introducing-system-one-models-and-jev'},
               'scored': scored, 'metrics': metrics, 'outputs': outputs}
    destination = ROOT / '.evidence/372-advisory-evaluation.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'receipt': str(destination), 'metrics': metrics}, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
