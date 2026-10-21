#!/usr/bin/env python3
"""Admit the existing Deploy caller using public, source-bound review evidence."""
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('approval', Path(__file__).parents[1] / 'review/external-approval.py')
approval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(approval)
REPO = 'dgmolla/fitsy'
VERIFY = 352020416
DEPLOY = 352171272
APP = 5285837
VERIFY_DIGEST = '4ec5e8f23352b2d143b9219d4da521770189efaa9f4c95cc917388843b54fd76'


def require(value, message):
    if not value:
        raise ValueError(message)


def github(config, endpoint):
    # The workflow supplies only its read-only GitHub token, never the App key.
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def current(source):
    require(github({}, f'repos/{REPO}/git/ref/heads/main')['object']['sha'] == source,
            'superseded protected main source')


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
    if len(sys.argv) == 3 and sys.argv[1] == 'current':
        require(re.fullmatch('[0-9a-f]{40}', sys.argv[2]), 'invalid source')
        current(sys.argv[2])
        return
    result = admit(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()), int(os.environ['GITHUB_RUN_ID']))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'release_sha={result["release_sha"]}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f'Routine release refused: {error}', file=sys.stderr)
        sys.exit(1)
