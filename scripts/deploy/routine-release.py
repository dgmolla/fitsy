#!/usr/bin/env python3
"""Release the current main commit after its latest push Verify succeeds."""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = 'dgmolla/fitsy'


def require(value, message):
    if not value:
        raise ValueError(message)


def github(config, endpoint):
    # The workflow supplies only its read-only GitHub token, never the App key.
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True, timeout=30))


def current(source):
    require(github({}, f'repos/{REPO}/git/ref/heads/main')['object']['sha'] == source,
            'superseded protected main source')


def vercel_bot(value):
    return value.get('id') == 35613825 and value.get('login') == 'vercel[bot]' and value.get('type') == 'Bot'


def deployment_failure(source, row, status):
    # Diagnostics cannot admit an older source, retry a migration, or replace
    # the terminal provider failure if public health is itself unavailable.
    serving = 'unavailable'
    try:
        value = read_health('https://fitsy.org', timeout=5)
        sha = value.get('deploymentSha') if isinstance(value, dict) else None
        if isinstance(sha, str) and re.fullmatch('[0-9a-f]{40}', sha):
            serving = sha
    except (ValueError, OSError):
        pass
    logs = status.get('log_url')
    if not isinstance(logs, str) or not re.fullmatch(
            r'https://vercel\.com/dawits-projects-74b6e00f/fitsy-api/[A-Za-z0-9]+', logs):
        logs = 'https://vercel.com/dawits-projects-74b6e00f/fitsy-api/deployments'
    state = status['state'] if status['state'] in ('failure', 'error', 'inactive') else 'unknown'
    identity = row.get('id') if type(row.get('id')) is int else 'unknown'
    return (f'Vercel Git production deployment failed or inactive: state={state}, source={source}, '
            f'deployment={identity}; build/migration logs: {logs}; fitsy.org serving source: {serving}. '
            'For P3009, inspect scripts/deploy/migration-failure-audit.sql; '
            'recovery requires separately authorized maintenance, never automatic resolve or retry.')


def deployment(source):
    """Observe the existing Git producer, without deployment credentials."""
    rows = github({}, f'repos/{REPO}/deployments?sha={source}&environment=Production&per_page=100')
    require(isinstance(rows, list) and len(rows) < 100, 'complete production deployment list required')
    rows = [row for row in rows if row.get('sha') == source and row.get('environment') == 'Production'
            and vercel_bot(row.get('creator') or {})]
    if not rows:
        return None
    # GitHub returns newest first. Never substitute an older successful attempt
    # for a newer failed deployment of the same source.
    row = rows[0]
    statuses = github({}, f'repos/{REPO}/deployments/{row["id"]}/statuses?per_page=1')
    if not statuses:
        return None
    status = statuses[0]
    require(vercel_bot(status.get('creator') or {}) and status.get('environment') == 'Production',
            'untrusted production deployment status issuer/environment')
    if status['state'] in ('queued', 'pending', 'in_progress'):
        return None
    if status['state'] != 'success':
        raise ValueError(deployment_failure(source, row, status))
    url = status.get('environment_url', '')
    require(status.get('target_url') == url and re.fullmatch(
        r'https://fitsy-[a-z0-9]+-dawits-projects-74b6e00f\.vercel\.app', url),
        'unexpected immutable Vercel deployment URL')
    # Genuine Vercel Git records have production_environment=false and no App
    # field. Bind the actual issuer, exact SHA, environment and immutable URL.
    return {'deployment': row, 'status': status}


def read_health(base, timeout=30):
    request = urllib.request.Request(base + '/api/health', headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def health(source, base='https://fitsy.org'):
    value = read_health(base)
    require(value.get('status') == 'ok' and value.get('db') == 'connected'
            and value.get('deploymentSha') == source, 'production health/source mismatch')


def observe(source):
    deadline = time.monotonic() + 20 * 60
    for attempt in range(60):
        current(source)
        result = deployment(source)
        if result:
            try:
                health(source, result['status']['environment_url'])
                health(source)
            except (ValueError, urllib.error.URLError):
                # Domain assignment and public health can lag the Git status.
                # Keep the same exact source requirement until the bounded end.
                pass
            else:
                current(source)
                print(json.dumps(result))
                return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if attempt < 59:
            time.sleep(min(20, remaining))
    raise ValueError('exact successful Git deployment and serving health not observed within 20 minutes')


def verify_after_smoke(source, observed):
    def unchanged():
        latest = deployment(source)
        require(latest is not None
                and latest['deployment']['id'] == observed['deployment']['id']
                and latest['status']['environment_url'] == observed['status']['environment_url'],
                'production deployment changed or is no longer successful after smoke')
        return latest
    latest = unchanged()
    health(source, latest['status']['environment_url'])
    health(source)
    # A retry can begin during the health reads. Recheck the existing producer
    # after those reads, without waiting for or adopting a replacement attempt.
    latest = unchanged()
    current(source)
    print(json.dumps(latest))


def admit(event, run_id):
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_run'
            and os.environ.get('GITHUB_REPOSITORY') == REPO
            and os.environ.get('GITHUB_REF') == 'refs/heads/main', 'unauthorized release event/repository/ref')
    upstream = event['workflow_run']
    source, verify_id = upstream['head_sha'], upstream['id']
    require(re.fullmatch('[0-9a-f]{40}', source) and type(verify_id) is int, 'invalid upstream source/run')
    endpoint = f'repos/{REPO}'
    verify = github({}, f'{endpoint}/actions/runs/{verify_id}')
    require(verify['id'] == verify_id and verify['head_sha'] == source,
            'upstream event/run mismatch')
    require(verify['path'] == '.github/workflows/verify.yml'
            and verify['event'] == 'push' and verify['head_branch'] == 'main'
            and verify['repository']['full_name'] == REPO and verify['head_repository']['full_name'] == REPO
            and verify['status'] == 'completed' and verify['conclusion'] == 'success',
            'successful same-repository main push Verify required')
    latest = github({}, f'{endpoint}/actions/workflows/verify.yml/runs?head_sha={source}&event=push&per_page=1')
    require(latest['workflow_runs'] and latest['workflow_runs'][0]['id'] == verify_id,
            'superseded Verify run')
    current(source)
    return {'release_sha': source}


def main():
    if len(sys.argv) > 1:
        require(sys.argv[1] in ('current', 'observe', 'health'), 'unsupported release command')
        require(len(sys.argv) == (4 if sys.argv[1] == 'health' else 3), 'release command arguments missing')
        require(re.fullmatch('[0-9a-f]{40}', sys.argv[2]), 'invalid source')
        current(sys.argv[2])
        if sys.argv[1] == 'observe':
            observe(sys.argv[2])
        elif sys.argv[1] == 'health':
            verify_after_smoke(sys.argv[2], json.loads(Path(sys.argv[3]).read_text()))
        return
    result = admit(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), int(os.environ['GITHUB_RUN_ID']))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'release_sha={result["release_sha"]}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired,
            urllib.error.URLError) as error:
        print(f'Routine release refused: {error}', file=sys.stderr)
        sys.exit(1)
