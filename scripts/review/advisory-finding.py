#!/usr/bin/env python3
"""On-demand, non-authoritative review finding advice from a bounded typed provider."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import urllib.request

dispatcher_path = Path(__file__).resolve().parents[1] / 'delivery/local-dispatcher.py'
dispatcher_spec = importlib.util.spec_from_file_location('fitsy_local_dispatcher', dispatcher_path)
dispatcher = importlib.util.module_from_spec(dispatcher_spec)
dispatcher_spec.loader.exec_module(dispatcher)
credential = dispatcher.credential  # Reuse the verified private-key reader.

VERSION = 'finding-advisory-v9'
DISPOSITIONS = ('fix_now', 'defer_with_owner', 'investigate', 'likely_unsupported')
REASONS = {
    'acceptance': 'A named mandatory acceptance criterion is unmet.',
    'material': 'The supplied evidence supports a material release defect.',
    'bounded_debt': 'The defect has a bounded trigger and an owned follow-up.',
    'insufficient': 'The supplied evidence is insufficient to decide.',
    'unsupported': 'The supplied evidence does not substantiate the finding.',
}
MAX_BYTES = 16000


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate(value):
    if not isinstance(value, dict) or len(json.dumps(value).encode()) > MAX_BYTES:
        raise ValueError('input must be an object of at most 16000 bytes')
    raw = value.get('raw')
    if not isinstance(raw, dict) or raw.get('verdict') not in ('pass', 'fail') or raw.get('priority') not in ('P0', 'P1', 'P2', 'P3') or raw.get('severity') not in ('CONFIRMED', 'PLAUSIBLE', 'NIT'):
        raise ValueError('raw verdict, priority and severity are required')
    if not isinstance(raw.get('finding'), str) or not raw['finding'].strip() or len(raw['finding']) > 4000:
        raise ValueError('raw finding is required and bounded')
    if not isinstance(raw.get('head'), str) or len(raw['head']) != 40 or any(c not in '0123456789abcdef' for c in raw['head']):
        raise ValueError('raw head must be a full lowercase SHA')
    if not isinstance(raw.get('source'), str) or not raw['source'].strip():
        raise ValueError('raw source is required')
    for key, limit in [('context', 6000), ('evidence', 3000), ('urgency_rubric', 2000)]:
        if not isinstance(value.get(key), str) or not value[key].strip() or len(value[key]) > limit:
            raise ValueError(f'{key} is required and bounded')
    criteria = value.get('acceptance_criteria')
    if not isinstance(criteria, list) or len(criteria) > 8 or any(not isinstance(c, dict) or not isinstance(c.get('id'), str) or not c['id'] or len(c['id']) > 80 or not isinstance(c.get('text'), str) or not c['text'] or len(c['text']) > 500 or not isinstance(c.get('source'), str) or not c['source'].startswith('https://') or len(c['source']) > 300 for c in criteria):
        raise ValueError('acceptance_criteria must be a bounded list of id/text/source triples')
    if len({c['id'] for c in criteria}) != len(criteria):
        raise ValueError('acceptance criterion IDs must be unique')
    owner = value.get('owner')
    followup = value.get('followup')
    if owner is not None and (not isinstance(owner, str) or len(owner) > 120):
        raise ValueError('owner is invalid')
    if followup is not None and (not isinstance(followup, str) or len(followup) > 300):
        raise ValueError('followup is invalid')
    return value


def questions(value):
    criteria = {'none': 'No concrete acceptance criterion is proven unmet.'}
    criteria.update({c['id']: c['text'] for c in value['acceptance_criteria']})
    return {
        'disposition': {'type': 'choice', 'instructions': 'Recommend a release disposition from the evidence. Priority is impact, not disposition. A confirmed P0/P1 or mandatory acceptance failure cannot be deferred. Uncertainty requires investigate.', 'criteria': {
            'fix_now': 'Material current release defect or proven mandatory acceptance failure.',
            'defer_with_owner': 'Real bounded defect with an owner and concrete follow-up; no essential acceptance failure.',
            'investigate': 'Conflicting or insufficient evidence, including possible high impact.',
            'likely_unsupported': 'Claim lacks support from the supplied independent evidence.'}},
        'reason': {'type': 'choice', 'instructions': 'Choose the strongest supported reason, without inventing evidence.', 'criteria': REASONS},
        'criterion': {'type': 'choice', 'instructions': 'Choose a concrete mandatory acceptance criterion for this release only if independent evidence proves it unmet. Follow-up repair acceptance does not count; otherwise choose none.', 'criteria': criteria},
    }


def provider_call(value, config):
    provider = config.get('provider', 'jev')
    if provider != 'jev':
        raise ValueError('unsupported configured provider')
    endpoint = config.get('endpoint', 'https://api.typesafe.ai/v1/systemone')
    if endpoint != 'https://api.typesafe.ai/v1/systemone':
        raise ValueError('unapproved provider endpoint')
    model = config.get('model', 'jev-latest')
    if not isinstance(model, str) or not model.startswith('jev-'):
        raise ValueError('invalid model')
    payload = {'model': model, 'state': value, 'questions': questions(value)}
    token = credential(config.get('key_file'))
    request = urllib.request.Request(endpoint, json.dumps(payload).encode(), {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.load(response)
    answers = result.get('answers')
    if not isinstance(answers, dict) or set(answers) != set(payload['questions']):
        raise ValueError('provider answer shape invalid')
    for name, question in payload['questions'].items():
        answer = answers[name]
        if not isinstance(answer, dict) or answer.get('choice') not in question['criteria']:
            raise ValueError('provider choice invalid')
        confidence = answer.get('confidence')
        probabilities = answer.get('probabilities')
        if isinstance(confidence, bool) or not isinstance(confidence, (float, int)) or not 0 <= confidence <= 1:
            raise ValueError('provider confidence invalid')
        if not isinstance(probabilities, dict) or set(probabilities) != set(question['criteria']) or any(isinstance(p, bool) or not isinstance(p, (float, int)) or not 0 <= p <= 1 for p in probabilities.values()) or not 0.99 <= sum(probabilities.values()) <= 1.01:
            raise ValueError('provider probabilities invalid')
    return result, model


def recommend(value, config, call=provider_call):
    validate(value)
    start = time.monotonic()
    provenance = {'input_sha256': digest(value), 'prompt_version': VERSION, 'provider': config.get('provider', 'jev'), 'model_requested': config.get('model', 'jev-latest'), 'model_returned': None, 'head': value['raw']['head'], 'source': value['raw']['source'], 'raw_verdict': value['raw']['verdict'], 'raw_priority': value['raw']['priority'], 'raw_severity': value['raw']['severity']}
    result = {'version': 1, 'status': 'unavailable', 'recommendation': 'investigate', 'reason': 'Provider unavailable; apply existing review disposition policy.', 'confidence': None, 'unmet_acceptance_criterion': None, 'potential_unmet_acceptance_criterion': None, 'owner': None, 'followup': None, 'fallback': 'existing_source_bound_review_policy', 'provenance': provenance, 'cost_usd': None, 'estimated_cost_usd': None}
    try:
        response, model = call(value, config)
        answers = response['answers']
        provenance['model_requested'] = model
        provenance['model_returned'] = response.get('model')
        choice = answers['disposition']['choice']
        provider_choice = choice
        provider_confidence = answers['disposition']['confidence']
        criterion = answers['criterion']['choice']
        reason = answers['reason']['choice']
        # A split between compatible explanation labels must not erase a clear
        # disposition. Only the disposition and a fix-now criterion need a
        # confidence floor.
        confirmed_high = value['raw']['severity'] == 'CONFIRMED' and value['raw']['priority'] in ('P0', 'P1')
        if provider_confidence < 0.6 or (choice == 'fix_now' and criterion != 'none' and answers['criterion']['confidence'] < 0.6 and not confirmed_high):
            choice = 'investigate'
            reason_text = 'Provider uncertainty requires investigation.'
        else:
            reason_text = REASONS[reason]
        named_criterion = next((c for c in value['acceptance_criteria'] if c['id'] == criterion), None)
        if value['raw']['priority'] in ('P0', 'P1') and choice in ('defer_with_owner', 'likely_unsupported'):
            choice, reason_text = 'investigate', 'High-impact finding requires source-bound investigation.'
        if choice in ('defer_with_owner', 'likely_unsupported') and named_criterion:
            choice, reason_text = 'investigate', 'Provider advice conflicts with a potentially unmet acceptance criterion.'
        if choice in ('defer_with_owner', 'likely_unsupported') and reason == 'acceptance':
            choice, reason_text = 'investigate', 'Provider advice conflicts with its mandatory-acceptance reason.'
        if choice == 'defer_with_owner' and value['acceptance_criteria'] and criterion == 'none' and answers['criterion']['confidence'] < 0.6:
            choice, reason_text = 'investigate', 'Provider is uncertain whether a mandatory acceptance criterion is unmet.'
        if choice == 'defer_with_owner' and (not value.get('owner') or not value.get('followup')):
            choice, reason_text = 'investigate', 'Deferral needs a named owner and follow-up.'
        policy_criterion = {'id': 'confirmed-p0-p1-release-rule',
                            'text': 'Confirmed P0/P1 findings block release until resolved.',
                            'source': 'https://github.com/dgmolla/fitsy/blob/main/docs/engineering/devops/review-dispositions.md#priority-and-supported-dispositions'}
        if choice == 'fix_now' and (not named_criterion or answers['criterion']['confidence'] < 0.6) and not confirmed_high:
            choice, reason_text = 'investigate', 'Fix-now advice needs a named criterion or confirmed P0/P1 release rule.'
        unmet = (named_criterion if named_criterion and answers['criterion']['confidence'] >= 0.6 else policy_criterion) if choice == 'fix_now' else None
        potential = named_criterion if choice == 'investigate' and criterion != 'none' else None
        result.update({'status': 'available', 'recommendation': choice, 'reason': reason_text,
                       'confidence': provider_confidence if choice == provider_choice else None,
                       'provider_disposition': provider_choice, 'provider_confidence': provider_confidence,
                       'unmet_acceptance_criterion': unmet, 'potential_unmet_acceptance_criterion': potential,
                       'owner': value.get('owner') if choice == 'defer_with_owner' else None,
                       'followup': value.get('followup') if choice == 'defer_with_owner' else None})
        result['provider_answers'] = answers
        usage = response.get('usage')
        if isinstance(usage, dict):
            result['usage'] = usage
            tokens = usage.get('input_tokens')
            if isinstance(tokens, int) and tokens >= 0 and config.get('usd_per_million_input_tokens') is not None:
                result['estimated_cost_usd'] = round(tokens * config['usd_per_million_input_tokens'] / 1000000, 10)
        actual_cost = response.get('cost_usd')
        if isinstance(actual_cost, (int, float)) and not isinstance(actual_cost, bool) and actual_cost >= 0:
            result['cost_usd'] = actual_cost
    except Exception as error:
        result['error_kind'] = type(error).__name__
    result['latency_ms'] = round((time.monotonic() - start) * 1000)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='bounded JSON finding input')
    parser.add_argument('--config', help='private adapter JSON; defaults to dispatcher Jev key')
    args = parser.parse_args()
    try:
        config = json.loads(Path(args.config).read_text()) if args.config else {'key_file': str(Path.home() / '.fitsy-dispatcher/credentials/jev.env'), 'usd_per_million_input_tokens': 0.042}
        if not isinstance(config, dict):
            raise ValueError('adapter config must be an object')
        value = json.loads(Path(args.input).read_text())
        print(json.dumps(recommend(value, config), sort_keys=True))
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f'[advisory-finding] {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
