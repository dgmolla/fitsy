#!/usr/bin/env python3
"""Validate complete domain coverage before deriving any compatibility verdict."""
import argparse
import json
import re
import sys


def validate(value, required):
    if not isinstance(value, dict) or value.get('verdict') not in ('pass', 'fail'):
        return None
    domains = value.get('domains')
    findings = value.get('findings')
    if not isinstance(domains, dict) or set(domains) != set(required) or not isinstance(findings, list):
        return None
    grouped = {}
    for finding in findings:
        if not isinstance(finding, dict) or finding.get('severity') not in ('CONFIRMED', 'PLAUSIBLE', 'NIT') or finding.get('priority') not in ('P0', 'P1', 'P2', 'P3'):
            return None
        if type(finding.get('line')) is not int or finding['line'] < 0:
            return None
        if any(not isinstance(finding.get(key), str) or not finding[key].strip() for key in ('file', 'summary', 'scenario', 'fix', 'impact')):
            return None
        attribution = finding.get('domains')
        if not isinstance(attribution, list) or not attribution or any(domain not in required for domain in attribution):
            return None
        # Same behavior reported through multiple domains is one finding.
        key = tuple(finding[field].strip() if isinstance(finding[field], str) else finding[field] for field in ('file', 'line', 'summary', 'scenario'))
        current = grouped.get(key)
        if current is None:
            grouped[key] = dict(finding, domains=sorted(set(attribution)))
        else:
            current['domains'] = sorted(set(current['domains'] + attribution))
            if ('CONFIRMED', 'PLAUSIBLE', 'NIT').index(finding['severity']) < ('CONFIRMED', 'PLAUSIBLE', 'NIT').index(current['severity']):
                current['severity'] = finding['severity']
            current['priority'] = min(current['priority'], finding['priority'])
    # Check the raw attribution before deduplication so duplicate normalization
    # cannot silently excuse a provider's inconsistent per-domain verdict.
    for domain in required:
        expected = 'fail' if any(f['severity'] == 'CONFIRMED' and domain in f['domains'] for f in findings) else 'pass'
        if domains.get(domain) != expected:
            return None
    expected = 'fail' if any(f['severity'] == 'CONFIRMED' for f in findings) else 'pass'
    if value['verdict'] != expected:
        return None
    result = dict(value, findings=list(grouped.values()))
    # Propagate strongest evidence across every attribution after deduplication.
    result['domains'] = {domain: 'fail' if any(f['severity'] == 'CONFIRMED' and domain in f['domains'] for f in result['findings']) else 'pass' for domain in required}
    return result


def extract(raw, required):
    try:
        value = json.loads(raw)
    except ValueError:
        value = None
    if isinstance(value, dict):
        if value.get('is_error') is True or value.get('error'):
            return None
        if 'result' in value:
            raw = value['result']
            if not isinstance(raw, str):
                return None
        else:
            return validate(value, required)
    blocks = re.findall(r'```json\s*(.*?)```', raw, re.S)
    if len(blocks) > 1:
        return None
    try:
        return validate(json.loads(blocks[0] if blocks else raw), required)
    except ValueError:
        return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('domains', help='space-separated required domains')
    parser.add_argument('--execution-error', action='store_true')
    parser.add_argument('--project')
    args = parser.parse_args()
    required = args.domains.split()
    raw = sys.stdin.read()
    result = extract(raw, required)
    if args.project and result is None:
        try:
            prior = json.loads(raw)
            if prior.get('verdict') == 'incomplete' and prior.get('domains') == {domain: 'incomplete' for domain in required} and prior.get('findings') == [] and isinstance(prior.get('error'), dict):
                result = prior
        except (ValueError, AttributeError):
            pass
    if args.execution_error or result is None:
        result = {'verdict': 'incomplete', 'domains': {domain: 'incomplete' for domain in required}, 'findings': [], 'error': {'kind': 'execution_error' if args.execution_error else 'invalid_output', 'message': 'reviewer execution failed' if args.execution_error else 'reviewer response lacks complete, valid required-domain results'}}
    if args.project:
        if args.project not in required:
            parser.error('projection domain is not required')
        result = dict(result, lens=args.project, verdict=result['domains'][args.project], findings=[f for f in result['findings'] if args.project in f['domains']])
        for finding in result['findings']:
            finding.pop('domains', None)
    print(json.dumps(result))
