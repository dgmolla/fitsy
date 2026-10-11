#!/usr/bin/env -S -i /usr/bin/python3 -I
"""One-shot bridge from independently held existing review evidence to GitHub.

Install only after independent review, under a separate OS operator identity.
This is not a reviewer, installer, scheduler, cache, or production deployer.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys

CONFIG = Path('/private/etc/fitsy/delivery-authority.json' if sys.platform == 'darwin'
              else '/etc/fitsy/delivery-authority.json')
INSTALL = Path('/opt/fitsy-approval/external-approval.py')
REPO = 'dgmolla/fitsy'
CHECK = 'delivery/independent-review'
ACCEPTANCE_CHECK = 'delivery/acceptance'
CONTROL_AREAS = ('scripts/review/', 'scripts/verify/', 'scripts/delivery/',
                 'docs/engineering/devops/', '.githooks/', 'AGENTS.md',
                 'scripts/sim/product-flow.mjs', 'scripts/sim/publish-product-flow.mjs',
                 'scripts/sim/runner-controls.test.mjs',
                 '.github/workflows/deploy.yml', '.github/workflows/eas-build.yml', 'vercel.json')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def protected_bytes(path, uid, private=False):
    """Reject links and writable ancestors, not merely a private leaf mode."""
    path = Path(path)
    require(path.is_absolute(), 'operator paths must be absolute')
    for probe in [path, *path.parents]:
        stat = probe.lstat()
        require(not probe.is_symlink() and stat.st_uid in (0, uid)
                and not stat.st_mode & 0o022, 'operator custody is unsafe')
    require(path.is_file(), 'operator artifact must be a regular file')
    if private:
        require(not path.stat().st_mode & 0o077, 'operator credential must be private')
    return path.read_bytes()


def authority():
    uid = os.getuid()
    config = json.loads(protected_bytes(CONFIG, uid))
    require(type(config.get('operator_uid')) is int and uid == config['operator_uid']
            and type(config.get('candidate_uid')) is int
            and uid != config['candidate_uid'], 'candidate cannot act as operator')
    require(Path(__file__).absolute() == INSTALL
            and digest(protected_bytes(INSTALL, uid)) == config['adapter_sha256'],
            'only independently approved installed adapter may issue checks')
    require(config['repository'] == REPO, 'repository mismatch')
    require(digest(protected_bytes(config['gh_path'], uid)) == config['gh_sha256'],
            'installed GitHub transport changed')
    require(type(config['app_id']) is int and config['app_id'] > 0,
            'real check issuer App ID is required')
    return config


def github(config, endpoint, payload=None, release=False):
    token_path = config['release_token_file' if release else 'app_token_file']
    token = protected_bytes(token_path, config['operator_uid'], private=True).decode().strip()
    require(bool(token), 'operator credential unavailable')
    # Never inherit candidate GitHub, proxy, loader, startup or executable selectors.
    env = {'PATH': '/usr/bin:/bin', 'HOME': pwd.getpwuid(os.getuid()).pw_dir,
           'GH_TOKEN': token, 'GH_HOST': 'github.com', 'GH_CONFIG_DIR': '/var/empty',
           'NO_COLOR': '1'}
    argv = [config['gh_path'], 'api', '--hostname', 'github.com',
            '-H', 'Accept: application/vnd.github+json', endpoint]
    if payload is not None:
        argv += ['--method', 'POST', '--input', '-']
    result = subprocess.run(argv, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, env=env, timeout=60)
    require(result.returncode == 0, 'GitHub operation failed; no approval inferred')
    return json.loads(result.stdout)


def acceptance(body):
    # Same normalization as the existing runner, including its shell newline trim.
    lines, in_details = [], False
    for line in body.splitlines():
        if re.match(r'^\s*<details(?:\s|>)', line, re.I):
            in_details = True
        if not in_details and re.match(r'^\s*(?:\*\*)?(?:Status|Next|Done|Blocker)(?:\*\*)?\s*:', line, re.I):
            continue
        lines.append(line)
    return digest('\n'.join(lines).rstrip('\n').encode())


def validate_review(approval, artifacts, ledger, policy, issue, source, body):
    """Validate an operator-observed execution, never trust candidate receipts alone."""
    require(approval['issue'] == issue and approval['source_sha'] == source
            and re.fullmatch(r'[0-9a-f]{40}', source)
            and re.fullmatch(r'[0-9a-f]{40}', approval['base_sha']), 'review source mismatch')
    require(approval['acceptance_sha256'] == acceptance(body), 'acceptance changed')
    require(approval['domains'] == policy['domains'] and bool(policy['domains'])
            and len(set(policy['domains'])) == len(policy['domains']), 'required domains mismatch')
    require((approval['provider'], approval['model'], approval['reasoning_effort'])
            == ('codex', 'gpt-6-sol', 'high'), 'provider policy mismatch')
    require(digest(ledger) == policy['ledger_sha256'], 'original cumulative history changed')
    require(set(artifacts) == {'verdict', 'execution', 'prompt', 'stderr'}, 'missing raw artifacts')
    for name, raw in artifacts.items():
        require(digest(raw) == approval['artifacts'][name]['sha256'], 'raw provider artifact changed')
    execution = json.loads(artifacts['execution'])
    seconds = execution.get('elapsed_seconds')
    require(execution.get('kind') == 'completed' and execution.get('returncode') == 0
            and type(seconds) in (float, int) and 0 < seconds <= policy['execution_timeout_seconds']
            and execution.get('stdout_bytes') == len(artifacts['verdict'])
            and execution.get('stderr_bytes') == len(artifacts['stderr']), 'incomplete provider execution')
    verdict = json.loads(artifacts['verdict'])
    require(verdict.get('source_sha') == source and verdict.get('base_sha') == approval['base_sha']
            and set(verdict.get('domains', {})) == set(policy['domains'])
            and all(row == {'verdict': 'pass', 'findings': []} for row in verdict['domains'].values())
            and isinstance(verdict.get('summary'), str) and verdict['summary'].strip()
            and isinstance(verdict.get('limitations'), list), 'review did not pass all required domains')
    prompt, trace = artifacts['prompt'].decode(), artifacts['stderr'].decode()
    require(source in prompt and approval['base_sha'] in prompt and f'issue{issue}' in prompt
            and all(domain in prompt for domain in policy['domains'])
            and all(marker in trace for marker in ('model: gpt-6-sol\n', 'sandbox: read-only\n',
                                                   'approval: never\n', 'reasoning effort: high\n')),
            'provider context mismatch')
    # Accounting remains in the existing ledger. The independent operator pins its
    # post-reconciliation bytes only after checking all historical allocations,
    # failed/incomplete time, and this real execution through the supported runner.
    require(policy['accounting_provenance'].startswith(f'https://github.com/{REPO}/issues/{issue}#issuecomment-'),
            'independent accounting verification missing')


def review_inputs(config, issue, source, body):
    uid = config['operator_uid']
    policy = config['reviews'][str(issue)]
    raw = protected_bytes(Path(config['review_home']) / 'completed' / f'issue-{issue}.json', uid)
    require(digest(raw) == policy['manifest_sha256'], 'unapproved execution manifest')
    approval = json.loads(raw)
    artifacts = {name: protected_bytes(row['path'], uid) for name, row in approval['artifacts'].items()}
    ledger = protected_bytes(Path(config['budget_home']) / f'issue-{issue}.jsonl', uid)
    validate_review(approval, artifacts, ledger, policy, issue, approval['source_sha'], body)
    if source != approval['source_sha']:
        require(issue == 443, 'changed controls require fresh independent control review')
        validate_composition(git_tree(config, approval['source_sha']), git_tree(config, source),
                             git_tree(config, config['control_sha']), config['control_paths'])
    return approval


def git_tree(config, source):
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'tree source identity invalid')
    endpoint = f'repos/{REPO}/git'
    tree_sha = github(config, f'{endpoint}/commits/{source}')['tree']['sha']
    result = github(config, f'{endpoint}/trees/{tree_sha}?recursive=1')
    require(not result['truncated'], 'complete source tree required')
    return {row['path']: (row['mode'], row['type'], row['sha'])
            for row in result['tree'] if row['type'] != 'tree'}


def validate_composition(reviewed, candidate, controls, allowed):
    """Reuse frozen443 only for exact product blobs with approved control blobs."""
    require(bool(allowed) and len(set(allowed)) == len(allowed), 'explicit approved control paths required')
    require(all(any(path == area or (area.endswith('/') and path.startswith(area))
                    for area in CONTROL_AREAS) for path in allowed), 'product path cannot be a control')
    for path in set(reviewed) | set(candidate) | set(allowed):
        expected = controls.get(path) if path in allowed else reviewed.get(path)
        require(candidate.get(path) == expected, f'frozen product or approved control changed: {path}')


def validate_pr(pr, issue, source):
    require(pr['state'] == 'open' and pr['base']['ref'] == 'main'
            and pr['head']['sha'] == source
            and pr['base']['repo']['full_name'] == REPO
            and pr['head']['repo']['full_name'] == REPO, 'PR source/repository mismatch')
    require(re.findall(r'^Delivery-Issue: #([1-9][0-9]*)\s*$', pr['body'] or '', re.M) == [str(issue)],
            'PR delivery issue mismatch')


def publish(config, issue, pr_number):
    endpoint = f'repos/{REPO}'
    pr = github(config, f'{endpoint}/pulls/{pr_number}')
    source = pr['head']['sha']
    validate_pr(pr, issue, source)
    body = github(config, f'{endpoint}/issues/{issue}')['body']
    approval = review_inputs(config, issue, source, body)
    # Recheck immediately before the write. A later push receives no approval.
    validate_pr(github(config, f'{endpoint}/pulls/{pr_number}'), issue, source)
    require(acceptance(github(config, f'{endpoint}/issues/{issue}')['body']) == approval['acceptance_sha256'],
            'acceptance changed during approval')
    check = github(config, f'{endpoint}/check-runs', {
        'name': CHECK, 'head_sha': source, 'status': 'completed', 'conclusion': 'success',
        'external_id': f'issue-{issue}:{source}:{approval["acceptance_sha256"]}',
        'output': {'title': 'Independent execution validated', 'summary':
                   f'Source {source}; base {approval["base_sha"]}; '
                   f'acceptance {approval["acceptance_sha256"]}; '
                   f'accounting {config["reviews"][str(issue)]["accounting_provenance"]}'}})
    require(check['app']['id'] == config['app_id'] and check['head_sha'] == source
            and check['conclusion'] == 'success', 'actual check issuer mismatch; stop cutover')
    return {'issue': issue, 'source_sha': source, 'check_url': check['html_url'], 'app_id': check['app']['id']}


def validate_acceptance(receipt, policy, source):
    require(receipt['head_sha'] == source and receipt['source_identity'] == policy['source_identity']
            and receipt['stage'] == 'full' and receipt['finished_at']
            and receipt['arguments'] == policy['arguments'], 'local acceptance source/recipe mismatch')
    results = {row['name']: row for row in receipt['results']}
    require(len(results) == len(receipt['results']) and policy['required_checks'], 'acceptance checks missing')
    require(all(results.get(name, {}).get('status') == status
                for name, status in policy['required_checks'].items()), 'required local acceptance failed')
    require(not any(row.get('blocking') is True and row['status'] not in ('pass', 'skipped')
                    for row in results.values()), 'blocking local acceptance failed')


def publish_acceptance(config, issue, pr_number, verify_id):
    endpoint = f'repos/{REPO}'
    pr = github(config, f'{endpoint}/pulls/{pr_number}')
    source = pr['head']['sha']
    validate_pr(pr, issue, source)
    body = github(config, f'{endpoint}/issues/{issue}')['body']
    review = review_inputs(config, issue, source, body)
    policy = config['local_acceptance'][str(issue)]
    raw = protected_bytes(policy['receipt_path'], config['operator_uid'])
    require(digest(raw) == policy['receipt_sha256'], 'unverified local acceptance receipt')
    validate_acceptance(json.loads(raw), policy, source)
    verify = github(config, f'{endpoint}/actions/runs/{verify_id}')
    require(verify['workflow_id'] == config['verify_workflow_id']
            and verify['head_sha'] == source and verify['event'] == 'pull_request'
            and verify['repository']['full_name'] == REPO and verify['status'] == 'completed'
            and verify['conclusion'] == 'success', 'exact candidate Verify did not pass')
    runs = github(config, f'{endpoint}/actions/workflows/{config["verify_workflow_id"]}/runs?head_sha={source}&event=pull_request&per_page=1')
    require(runs['workflow_runs'] and runs['workflow_runs'][0]['id'] == verify_id,
            'superseded Verify cannot authorize acceptance')
    validate_pr(github(config, f'{endpoint}/pulls/{pr_number}'), issue, source)
    require(acceptance(github(config, f'{endpoint}/issues/{issue}')['body']) == review['acceptance_sha256'],
            'acceptance changed during publication')
    check = github(config, f'{endpoint}/check-runs', {
        'name': ACCEPTANCE_CHECK, 'head_sha': source, 'status': 'completed', 'conclusion': 'success',
        'output': {'title': 'Required acceptance validated',
                   'summary': f'Operator-observed local receipt {digest(raw)}; exact-source Verify run {verify_id}.'}})
    require(check['app']['id'] == config['app_id'] and check['head_sha'] == source
            and check['conclusion'] == 'success', 'actual acceptance issuer mismatch')
    return {'source_sha': source, 'check_url': check['html_url'], 'verify_run': verify_id}


def validate_release(run, verify, main, check_runs, protection, config):
    source = run['head_sha']
    require(run['path'] == '.github/workflows/deploy.yml' and run['event'] == 'workflow_run'
            and run['head_branch'] == 'main' and run['repository']['full_name'] == REPO
            and source == main, 'release source is not current protected main')
    require(verify['path'] == '.github/workflows/verify.yml' and verify['event'] == 'push'
            and verify['repository']['full_name'] == REPO and verify['head_branch'] == 'main'
            and verify['head_sha'] == source and verify['status'] == 'completed'
            and verify['conclusion'] == 'success', 'required main Verify failed or mismatched')
    required = protection['required_status_checks']
    require(protection['enforce_admins']['enabled'] and required['strict']
            and all({'context': name, 'app_id': config['app_id']} in required['checks']
                    for name in (CHECK, ACCEPTANCE_CHECK)),
            'protected issuer binding unavailable')
    # GitHub supplies current check runs with filter=latest, including reruns.
    for spec in config['release_checks']:
        matching = [check for check in check_runs if check['name'] == spec['name']
                    and check['app']['id'] == spec['app_id'] and check['head_sha'] == source]
        require(len(matching) == 1 and matching[0]['status'] == 'completed'
                and matching[0]['conclusion'] == 'success', 'required release check failed or ambiguous')


def validate_merge_custody(ruleset, config):
    require(ruleset['target'] == 'branch' and ruleset['enforcement'] == 'active'
            and ruleset['conditions']['ref_name'] == {'include': ['refs/heads/main'], 'exclude': []}
            and ruleset['bypass_actors'] == [{'actor_id': config['merge_operator_user_id'],
                                             'actor_type': 'User', 'bypass_mode': 'pull_request'}]
            and ruleset['rules'] == [{'type': 'update',
                                     'parameters': {'update_allows_fetch_and_merge': False}}],
            'exclusive independent merge custody unavailable')


def validate_release_reviewer(environment, actor_ids, reviewer_id, config):
    require(type(config.get('release_reviewer_user_id')) is int
            and reviewer_id == config['release_reviewer_user_id']
            and reviewer_id != config['merge_operator_user_id']
            and reviewer_id not in actor_ids, 'release reviewer must be distinct from initiating actors')
    rules = [row for row in environment['protection_rules'] if row['type'] == 'required_reviewers']
    require(environment['name'] == 'production-release' and environment['can_admins_bypass'] is False
            and len(rules) == 1 and rules[0]['prevent_self_review'] is True
            and [{'type': row['type'], 'id': row['reviewer']['id']} for row in rules[0]['reviewers']]
            == [{'type': 'User', 'id': reviewer_id}], 'independent production reviewer protection unavailable')
    require(environment['deployment_branch_policy'] == {'protected_branches': False,
                                                       'custom_branch_policies': True},
            'production branch protection unavailable')


def release_ready(config, run_id, verify_id):
    endpoint = f'repos/{REPO}'
    run = github(config, f'{endpoint}/actions/runs/{run_id}', release=True)
    verify = github(config, f'{endpoint}/actions/runs/{verify_id}', release=True)
    main = github(config, f'{endpoint}/git/ref/heads/main', release=True)['object']['sha']
    require(run['workflow_id'] == config['deploy_workflow_id']
            and verify['workflow_id'] == config['verify_workflow_id'], 'workflow identity mismatch')
    protection = github(config, f'{endpoint}/branches/main/protection', release=True)
    ruleset = github(config, f'{endpoint}/rulesets/{config["merge_custody_ruleset_id"]}', release=True)
    validate_merge_custody(ruleset, config)
    # Refuse pagination rather than silently truncate protection evidence.
    checks = github(config, f'{endpoint}/commits/{main}/check-runs?filter=latest&per_page=100', release=True)
    require(checks['total_count'] <= 100, 'release check pagination requires operator inspection')
    validate_release(run, verify, main, checks['check_runs'], protection, config)
    reviewer = github(config, 'user', release=True)
    environment = github(config, f'{endpoint}/environments/production-release', release=True)
    validate_release_reviewer(environment, [run['actor']['id'], run['triggering_actor']['id']],
                              reviewer['id'], config)
    branches = github(config, f'{endpoint}/environments/production-release/deployment-branch-policies', release=True)
    require(branches['total_count'] == 1 and branches['branch_policies'][0]['name'] == 'main'
            and branches['branch_policies'][0]['type'] == 'branch', 'production branch policy mismatch')
    merged = github(config, f'{endpoint}/commits/{main}/pulls?per_page=100', release=True)
    matching = [pr for pr in merged if pr.get('merged_at') and pr['merge_commit_sha'] == main
                and pr['base']['ref'] == 'main']
    require(len(merged) < 100 and len(matching) == 1, 'release lacks unique protected PR provenance')
    pr = matching[0]
    issues = re.findall(r'^Delivery-Issue: #([1-9][0-9]*)\s*$', pr['body'] or '', re.M)
    require(len(issues) == 1, 'merged PR issue missing or ambiguous')
    source = pr['head']['sha']
    issue = int(issues[0])
    body = github(config, f'{endpoint}/issues/{issue}', release=True)['body']
    review_inputs(config, issue, source, body)
    reviewed_tree = github(config, f'{endpoint}/git/commits/{source}', release=True)['tree']['sha']
    release_tree = github(config, f'{endpoint}/git/commits/{main}', release=True)['tree']['sha']
    require(reviewed_tree == release_tree, 'merged tree differs from independently reviewed candidate')
    pending = github(config, f'{endpoint}/actions/runs/{run_id}/pending_deployments', release=True)
    require(pending and all(row['environment']['name'] == 'production-release'
                           and row['current_user_can_approve'] for row in pending),
            'independent production environment approval unavailable')
    # Report only. The independent reviewer approves this exact run in GitHub
    # after inspecting workflow bytes, remaining product/legal gates and custody.
    return {'source_sha': main, 'reviewed_source_sha': source, 'issue': issue,
            'deploy_run': run_id, 'verify_run': verify_id,
            'environment_ids': [row['environment']['id'] for row in pending],
            'release': 'ready for independent environment review; not approved'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    review = commands.add_parser('publish-review')
    review.add_argument('--issue', type=int, required=True)
    review.add_argument('--pr', type=int, required=True)
    accepted = commands.add_parser('publish-acceptance')
    accepted.add_argument('--issue', type=int, required=True)
    accepted.add_argument('--pr', type=int, required=True)
    accepted.add_argument('--verify-run', type=int, required=True)
    release = commands.add_parser('release-ready')
    release.add_argument('--run', type=int, required=True)
    release.add_argument('--verify-run', type=int, required=True)
    args = parser.parse_args()
    try:
        config = authority()
        if args.action == 'publish-review':
            result = publish(config, args.issue, args.pr)
        elif args.action == 'publish-acceptance':
            result = publish_acceptance(config, args.issue, args.pr, args.verify_run)
        else:
            result = release_ready(config, args.run, args.verify_run)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'[external-approval] refused: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
