#!/usr/bin/env python3
"""Admit the existing Deploy caller using public, source-bound review evidence."""
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('approval', Path(__file__).parents[1] / 'review/external-approval.py')
approval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(approval)
REPO = 'dgmolla/fitsy'
VERIFY = 352020416
DEPLOY = 352171272
APP = 5285837
VERIFY_DIGEST = 'cda3a5aab96c35bc6c7aafdbf54e5541c4735b229f2f71ffa3b3342bf7c5d697'


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
    require(status['state'] == 'success', 'Vercel Git production deployment failed or inactive')
    url = status.get('environment_url', '')
    require(status.get('target_url') == url and re.fullmatch(
        r'https://fitsy-[a-z0-9]+-dawits-projects-74b6e00f\.vercel\.app', url),
        'unexpected immutable Vercel deployment URL')
    # Genuine Vercel Git records have production_environment=false and no App
    # field. Bind the actual issuer, exact SHA, environment and immutable URL.
    return {'deployment': row, 'status': status}


def health(source, base='https://fitsy.org'):
    request = urllib.request.Request(base + '/api/health', headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        value = json.load(response)
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
    run = github({}, f'{endpoint}/actions/runs/{run_id}')
    require(run['id'] == run_id and run['workflow_id'] == DEPLOY
            and run['path'] == '.github/workflows/deploy.yml' and run['event'] == 'workflow_run'
            and run['head_branch'] == 'main' and run['repository']['full_name'] == REPO
            and run['head_sha'] == source,
            'wrong downstream workflow identity')
    verify = github({}, f'{endpoint}/actions/runs/{verify_id}')
    require(all(verify[key] == upstream[key] for key in ('id', 'head_sha', 'run_attempt', 'workflow_id')),
            'upstream event/run mismatch')
    require(verify['workflow_id'] == VERIFY and verify['path'] == '.github/workflows/verify.yml'
            and verify['event'] == 'push' and verify['head_branch'] == 'main'
            and verify['repository']['full_name'] == REPO and verify['head_repository']['full_name'] == REPO
            and verify['status'] == 'completed' and verify['conclusion'] == 'success',
            'successful same-repository main push Verify required')
    latest = github({}, f'{endpoint}/actions/workflows/{VERIFY}/runs?head_sha={source}&event=push&per_page=1')
    require(latest['workflow_runs'] and latest['workflow_runs'][0]['id'] == verify_id,
            'superseded Verify run')
    current(source)
    config = {'verify_workflow_id': VERIFY, 'verify_workflow_sha256': VERIFY_DIGEST}
    # Main Verify is independently executed by GitHub, with the same required jobs.
    approval.github = github
    approval.validate_verify_jobs(config, verify, source,
                                  tuple(name for name in approval.VERIFY_JOBS if name != 'Single-domain PR check'))
    merged = github({}, f'{endpoint}/commits/{source}/pulls?per_page=100')
    prs = [p for p in merged if p.get('merged_at') and p.get('merge_commit_sha') == source
           and p['base']['ref'] == 'main']
    require(len(merged) < 100 and len(prs) == 1, 'unique merged PR provenance required')
    pr = prs[0]
    require(pr['state'] == 'closed' and all(pr[side]['repo']['full_name'] == REPO for side in ('head', 'base')),
            'merged PR repository/state mismatch')
    issues = re.findall(r'^Delivery-Issue: #([1-9][0-9]*)\s*$', pr['body'] or '', re.M)
    require(len(issues) == 1, 'merged PR delivery issue missing or ambiguous')
    issue, reviewed = int(issues[0]), pr['head']['sha']
    merge = github({}, f'{endpoint}/git/commits/{source}')
    parents = [parent['sha'] for parent in merge['parents']]
    require(len(parents) == 2 and parents[1] == reviewed, 'immutable merge parent/reviewed head mismatch')
    # GitHub's live PR base/associations may change after merge. The actual main
    # merge parents plus the App's reviewed base establish immutable provenance.
    pr = dict(pr, base=dict(pr['base'], sha=parents[0]))
    digest = approval.acceptance(github({}, f'{endpoint}/issues/{issue}')['body'])
    checks = github({}, f'{endpoint}/commits/{reviewed}/check-runs?filter=latest&per_page=100')
    require(checks['total_count'] <= 100 and checks['total_count'] == len(checks['check_runs']),
            'complete reviewed-head checks required')
    selected = {}
    for name in (approval.CHECK, approval.ACCEPTANCE_CHECK):
        matches = [c for c in checks['check_runs'] if c['name'] == name and c['app']['id'] == APP
                   and c['head_sha'] == reviewed]
        require(len(matches) == 1 and matches[0]['status'] == 'completed'
                and matches[0]['conclusion'] == 'success', 'independent App check missing, ambiguous or failed')
        selected[name] = matches[0]
    check = selected[approval.CHECK]
    require(check['external_id'] == f'issue-{issue}:{reviewed}:{digest}', 'current acceptance/review binding changed')
    require(f'Source {reviewed}; base {pr["base"]["sha"]}; acceptance {digest};' in check['output']['summary'],
            'review comparison base mismatch')
    tree = github({}, f'{endpoint}/git/commits/{reviewed}')['tree']['sha']
    require(merge['tree']['sha'] == tree,
            'merged tree differs from independently reviewed source')
    candidate = github({}, f'{endpoint}/actions/workflows/{VERIFY}/runs?head_sha={reviewed}&event=pull_request&per_page=1')
    require(candidate['workflow_runs'], 'candidate Verify missing')
    config['local_acceptance'] = {str(issue): {'source_tree_sha': tree}}
    approval.ci_acceptance(config, issue, pr, {'base_sha': pr['base']['sha']},
                           candidate['workflow_runs'][0]['id'], merged_main=source)
    approval.validate_product_status(github({}, f'{endpoint}/commits/{reviewed}/status?per_page=100'), reviewed)
    current(source)
    return {'release_sha': source, 'verify_run': verify_id, 'issue': issue}


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
