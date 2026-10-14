#!/usr/bin/env -S -i /usr/bin/python3 -I
"""One-shot bridge from independently held existing review evidence to GitHub.

Install only after independent review, under a separate OS operator identity.
This is not a reviewer, installer, scheduler, cache, or production deployer.
"""
import argparse
import base64
from datetime import datetime, timezone
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
                 'scripts/deploy/native-compatibility.test.ts',
                 'docs/engineering/devops/', '.githooks/', 'AGENTS.md',
                 'scripts/sim/product-flow.mjs', 'scripts/sim/publish-product-flow.mjs',
                 'scripts/sim/runner-controls.test.mjs',
                 '.github/workflows/deploy.yml', '.github/workflows/eas-build.yml',
                 '.github/workflows/dev-maintenance.yml', 'vercel.json')


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


def candidate_custody(config, uid):
    """Operator-pinned live boundary proof; candidate input/env cannot select authority.

    The default separate-UID contract remains. Profile custody is a prepared,
    independently reviewed installation option, never inferred from same UID or file mode.
    """
    require(type(config.get('operator_uid')) is int and uid == config['operator_uid']
            and type(config.get('candidate_uid')) is int, 'candidate cannot act as operator')
    boundary = config.get('candidate_boundary')
    if boundary is None:
        require(uid != config['candidate_uid'], 'candidate cannot act as operator')
        return
    require(uid == config['candidate_uid'] and boundary.get('kind') == 'codex-permission-profile',
            'unsupported candidate custody boundary')
    raw = protected_bytes(boundary['receipt_path'], uid, private=True)
    require(digest(raw) == boundary['receipt_sha256'], 'candidate boundary receipt changed')
    receipt = json.loads(raw)
    require(receipt.get('version') == 1 and receipt.get('claim_id') == boundary['claim_id']
            and receipt.get('issue') == boundary['issue']
            and receipt.get('source_sha') == boundary['source_sha']
            and receipt.get('comparison_base') == boundary['comparison_base']
            and receipt.get('independently_approved') is True,
            'candidate boundary approval/source mismatch')
    for key in ('source_sha', 'comparison_base'):
        require(isinstance(boundary[key], str) and re.fullmatch(r'[0-9a-f]{40}', boundary[key]),
                'candidate boundary source identity incomplete')
    for key in ('launcher', 'profile'):
        content = protected_bytes(boundary[key + '_path'], uid, private=(key == 'profile'))
        require(digest(content) == boundary[key + '_sha256'] == receipt.get(key + '_sha256'),
                'candidate boundary executable/profile changed')
    denials = receipt.get('live_denials') or {}
    require(all(denials.get(key) is True for key in (
        'operator_files', 'approval_credentials', 'claim_write', 'other_branch_write',
        'workspace_secrets', 'command_network', 'operator_execution')),
        'candidate boundary live denials incomplete')
    state = json.loads(protected_bytes(boundary['claim_state_path'], uid, private=True))
    claim = state.get('active') or {}
    observed = claim.get('worker_boundary') or {}
    require(claim.get('id') == boundary['claim_id'] and claim.get('issue') == boundary['issue']
            and observed.get('kind') == boundary['kind']
            and observed.get('config_sha256') == boundary['profile_sha256']
            and observed.get('operator_home_read') is False and observed.get('network') is False,
            'candidate boundary does not match original claim')
    require(claim.get('stage') == 'running' and not claim.get('finished_at')
            and type(claim.get('pid')) is int and claim['pid'] > 0
            and receipt.get('worker_pid') == claim['pid']
            and receipt.get('worker_started') == claim.get('pid_started')
            and type(claim.get('worker_pgid')) is int
            and claim['worker_pgid'] != os.getpgrp(), 'candidate boundary is inactive or operator is candidate')
    process = subprocess.run(['/bin/ps', '-p', str(claim['pid']), '-o', 'lstart='],
                             capture_output=True, text=True, timeout=10,
                             env={'PATH': '/usr/bin:/bin'})
    require(process.returncode == 0 and bool(claim.get('pid_started'))
            and process.stdout.strip() == claim['pid_started']
            and os.getpgid(claim['pid']) == claim['worker_pgid'], 'candidate process identity changed')


def authority():
    uid = os.getuid()
    config = json.loads(protected_bytes(CONFIG, uid))
    candidate_custody(config, uid)
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
    token_raw = protected_bytes(token_path, config['operator_uid'], private=True)
    if not release:
        provenance = protected_bytes(config['app_identity_file'], config['operator_uid'], private=True)
        require(digest(provenance) == config['app_identity_sha256'], 'unverified App token provenance')
        issued = json.loads(provenance)['token']
        require(digest(token_raw) == issued['sha256']
                and datetime.fromisoformat(issued['expires_at'].replace('Z', '+00:00')) > datetime.now(timezone.utc),
                'App token changed or expired before request')
    token = token_raw.decode().strip()
    require(bool(token), 'operator credential unavailable')
    # Never inherit candidate GitHub, proxy, loader, startup or executable selectors.
    env = {'PATH': '/usr/bin:/bin', 'HOME': pwd.getpwuid(os.getuid()).pw_dir,
           'GH_TOKEN': token, 'GH_HOST': 'github.com', 'GH_CONFIG_DIR': '/var/empty',
           'NO_COLOR': '1'}
    argv = [config['gh_path'], 'api', '--hostname', 'github.com',
            '-H', 'Accept: application/vnd.github+json', endpoint]
    if payload is not None:
        if config.get('candidate_boundary') is not None:
            candidate_custody(config, config['operator_uid'])
        argv += ['--method', 'POST', '--input', '-']
    result = subprocess.run(argv, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, env=env, timeout=60)
    require(result.returncode == 0, 'GitHub operation failed; no approval inferred')
    return json.loads(result.stdout) if result.stdout.strip() else None



def installation_identity(config):
    """Operator-pinned, observed token issuance, plus live scope readback.

    Installation tokens cannot call JWT-only App identity endpoints.
    The operator retains those actual responses at token renewal, never the key.
    This manifest is credential provenance, not a review verdict or grant.
    """
    uid = config['operator_uid']
    raw = protected_bytes(config['app_identity_file'], uid, private=True)
    require(digest(raw) == config['app_identity_sha256'], 'unverified App token provenance')
    identity = json.loads(raw)
    app, installation, token = identity['app'], identity['installation'], identity['token']
    require(config['app_id'] == 5285837 and config['installation_id'] == 170592990
            and app['id'] == config['app_id'] and installation['app_id'] == app['id']
            and installation['id'] == config['installation_id']
            and installation['account']['login'] == 'dgmolla'
            and installation['repository_selection'] == 'selected', 'App issuer/installation mismatch')
    expected = {'metadata': 'read', 'checks': 'write', 'contents': 'read', 'issues': 'read',
                'pull_requests': 'read', 'actions': 'write', 'administration': 'read'}
    require(installation['permissions'] == expected and token['permissions'] == expected,
            'App effective permissions mismatch')
    require(token['sha256'] == digest(protected_bytes(config['app_token_file'], uid, private=True))
            and datetime.fromisoformat(token['expires_at'].replace('Z', '+00:00')) > datetime.now(timezone.utc),
            'App token changed or expired')
    scope = github(config, 'installation/repositories?per_page=100')
    require(scope['total_count'] == 1 and len(scope['repositories']) == 1
            and scope['repositories'][0]['full_name'] == REPO
            and scope['repositories'][0]['id'] == identity['repository_id'], 'App repository scope mismatch')
    live_app = github(config, f'apps/{app["slug"]}')
    actor = github(config, f'users/{app["slug"]}[bot]')
    require(live_app['id'] == app['id'] and actor['type'] == 'Bot'
            and actor['login'] == config['dispatch_actor_login']
            and type(config['dispatch_actor_user_id']) is int
            and actor['id'] == config['dispatch_actor_user_id']
            and actor['id'] != config['merge_operator_user_id'], 'App dispatch actor mismatch')


def workflow_identity(config, source):
    repo = github(config, f'repos/{REPO}')
    require(repo['default_branch'] == 'main', 'release workflow must be on default main branch')
    for name in ('deploy', 'verify'):
        workflow = github(config, f'repos/{REPO}/actions/workflows/{config[name + "_workflow_id"]}')
        path = f'.github/workflows/{name}.yml'
        require(workflow['path'] == path and workflow['state'] == 'active', 'default workflow identity mismatch')
        blob = github(config, f'repos/{REPO}/contents/{path}?ref={source}')
        require(blob['type'] == 'file' and blob['path'] == path and blob['encoding'] == 'base64'
                and digest(base64.b64decode(blob['content'])) == config[name + '_workflow_sha256'],
                'default-branch workflow bytes changed')


def validate_dispatch_actor(run, config):
    expected = {'id': config['dispatch_actor_user_id'], 'login': config['dispatch_actor_login'], 'type': 'Bot'}
    require(type(expected['id']) is int and expected['id'] != config['merge_operator_user_id']
            and all(all(run[field][key] == value for key, value in expected.items())
                    for field in ('actor', 'triggering_actor')), 'independent App deployment initiation required')


def dispatch_title(source, verify_id, acceptance_sha):
    return f'Release {source} Verify {verify_id} Acceptance {acceptance_sha}'

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
    boundary = config.get('candidate_boundary')
    if boundary is not None:
        require(boundary['issue'] == issue and boundary['source_sha'] == source,
                'candidate boundary issue/source differs from reviewed candidate')
    uid = config['operator_uid']
    policy = config['reviews'][str(issue)]
    raw = protected_bytes(Path(config['review_home']) / 'completed' / f'issue-{issue}.json', uid)
    require(digest(raw) == policy['manifest_sha256'], 'unapproved execution manifest')
    approval = json.loads(raw)
    if boundary is not None:
        require(approval['base_sha'] == boundary['comparison_base'], 'candidate boundary comparison mismatch')
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
    installation_identity(config)
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
    installation_identity(config)
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
    require(run['path'] == '.github/workflows/deploy.yml' and run['event'] == 'workflow_dispatch'
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
    require(any(row['context'] == 'product-flow/local' for row in required['checks']),
            'required product gate removed from protected main')
    # GitHub supplies current check runs with filter=latest, including reruns.
    for spec in config['release_checks']:
        matching = [check for check in check_runs if check['name'] == spec['name']
                    and check['app']['id'] == spec['app_id'] and check['head_sha'] == source]
        require(len(matching) == 1 and matching[0]['status'] == 'completed'
                and matching[0]['conclusion'] == 'success', 'required release check failed or ambiguous')



def validate_product_status(status, source):
    require(status['sha'] == source and status['total_count'] <= 100,
            'reviewed-head product status source/pagination mismatch')
    rows = [row for row in status['statuses'] if row['context'] == 'product-flow/local']
    require(len(rows) == 1 and rows[0]['state'] == 'success', 'required reviewed-head product gate failed')

def validate_merge_custody(ruleset, config):
    # GitHub GET can omit the optional update parameters on a non-fork.
    # If present, accept only the explicit boolean false contract.
    rules = ruleset['rules']
    update_rule = rules[0] if type(rules) is list and len(rules) == 1 else None
    valid_update = type(update_rule) is dict and update_rule.get('type') == 'update'
    if valid_update and set(update_rule) == {'type', 'parameters'}:
        parameters = update_rule['parameters']
        valid_update = (type(parameters) is dict
                        and set(parameters) == {'update_allows_fetch_and_merge'}
                        and parameters['update_allows_fetch_and_merge'] is False)
    else:
        valid_update = valid_update and set(update_rule) == {'type'}
    require(ruleset['target'] == 'branch' and ruleset['enforcement'] == 'active'
            and ruleset['conditions']['ref_name'] == {'include': ['refs/heads/main'], 'exclude': []}
            and ruleset['bypass_actors'] == [{'actor_id': config['merge_operator_user_id'],
                                             'actor_type': 'User', 'bypass_mode': 'pull_request'}]
            and valid_update,
            'exclusive independent merge custody unavailable')


def validate_release_reviewer(environment, actor_ids, reviewer_id, config):
    require(type(config.get('release_reviewer_user_id')) is int
            and reviewer_id == config['release_reviewer_user_id']
            and (reviewer_id != config['merge_operator_user_id']
                 or (type(config.get('dispatch_actor_user_id')) is int
                     and actor_ids == [config['dispatch_actor_user_id']] * 2
                     and config['dispatch_actor_user_id'] != reviewer_id))
            and reviewer_id not in actor_ids, 'release reviewer must be distinct from initiating actors')
    rules = [row for row in environment['protection_rules'] if row['type'] == 'required_reviewers']
    require(environment['name'] == 'production-release' and environment['can_admins_bypass'] is False
            and len(rules) == 1 and rules[0]['prevent_self_review'] is True
            and [{'type': row['type'], 'id': row['reviewer']['id']} for row in rules[0]['reviewers']]
            == [{'type': 'User', 'id': reviewer_id}], 'independent production reviewer protection unavailable')
    require(environment['deployment_branch_policy'] == {'protected_branches': False,
                                                       'custom_branch_policies': True},
            'production branch protection unavailable')


def release_context(config, verify_id):
    endpoint = f'repos/{REPO}'
    main = github(config, f'{endpoint}/git/ref/heads/main')['object']['sha']
    workflow_identity(config, main)
    verify = github(config, f'{endpoint}/actions/runs/{verify_id}')
    require(verify['workflow_id'] == config['verify_workflow_id'], 'workflow identity mismatch')
    latest = github(config, f'{endpoint}/actions/workflows/{config["verify_workflow_id"]}/runs?head_sha={main}&event=push&per_page=1')
    require(latest['workflow_runs'] and latest['workflow_runs'][0]['id'] == verify_id,
            'superseded main Verify cannot authorize release')
    protection = github(config, f'{endpoint}/branches/main/protection')
    ruleset = github(config, f'{endpoint}/rulesets/{config["merge_custody_ruleset_id"]}')
    validate_merge_custody(ruleset, config)
    # Refuse pagination rather than silently truncate protection evidence.
    checks = github(config, f'{endpoint}/commits/{main}/check-runs?filter=latest&per_page=100')
    require(checks['total_count'] <= 100, 'release check pagination requires operator inspection')
    provisional = {'path': '.github/workflows/deploy.yml', 'event': 'workflow_dispatch',
                   'head_branch': 'main', 'head_sha': main, 'repository': {'full_name': REPO}}
    validate_release(provisional, verify, main, checks['check_runs'], protection, config)
    environment = github(config, f'{endpoint}/environments/production-release')
    validate_release_reviewer(environment, [config['dispatch_actor_user_id']] * 2,
                              config['release_reviewer_user_id'], config)
    branches = github(config, f'{endpoint}/environments/production-release/deployment-branch-policies')
    require(branches['total_count'] == 1 and branches['branch_policies'][0]['name'] == 'main'
            and branches['branch_policies'][0]['type'] == 'branch', 'production branch policy mismatch')
    merged = github(config, f'{endpoint}/commits/{main}/pulls?per_page=100')
    matching = [pr for pr in merged if pr.get('merged_at') and pr['merge_commit_sha'] == main
                and pr['base']['ref'] == 'main']
    require(len(merged) < 100 and len(matching) == 1, 'release lacks unique protected PR provenance')
    pr = matching[0]
    issues = re.findall(r'^Delivery-Issue: #([1-9][0-9]*)\s*$', pr['body'] or '', re.M)
    require(len(issues) == 1, 'merged PR issue missing or ambiguous')
    source = pr['head']['sha']
    product = github(config, f'{endpoint}/commits/{source}/status?per_page=100')
    validate_product_status(product, source)
    issue = int(issues[0])
    body = github(config, f'{endpoint}/issues/{issue}')['body']
    approval = review_inputs(config, issue, source, body)
    policy = config['local_acceptance'][str(issue)]
    receipt = protected_bytes(policy['receipt_path'], config['operator_uid'])
    require(digest(receipt) == policy['receipt_sha256'], 'unverified local acceptance receipt')
    validate_acceptance(json.loads(receipt), policy, source)
    reviewed_tree = github(config, f'{endpoint}/git/commits/{source}')['tree']['sha']
    release_tree = github(config, f'{endpoint}/git/commits/{main}')['tree']['sha']
    require(reviewed_tree == release_tree, 'merged tree differs from independently reviewed candidate')
    return {'source_sha': main, 'reviewed_source_sha': source, 'issue': issue,
            'acceptance_sha256': approval['acceptance_sha256'], 'verify_run': verify_id}


def dispatch_release(config, verify_id):
    installation_identity(config)
    context = release_context(config, verify_id)
    source = context['source_sha']
    # Bind the documented ref=main to the exact inspected default workflow/source.
    require(github(config, f'repos/{REPO}/git/ref/heads/main')['object']['sha'] == source,
            'main changed before dispatch')
    result = github(config, f'repos/{REPO}/actions/workflows/{config["deploy_workflow_id"]}/dispatches', {
        'ref': 'main', 'inputs': {'release_sha': source, 'verify_run': str(verify_id),
                                'acceptance_sha256': context['acceptance_sha256']}})
    # Older API versions return 204, newer versions return the run ID.
    # Neither is approval or proof of the initiating actor. No automatic retry.
    return {**context, 'dispatch_response': result,
            'release': 'dispatch submitted; actual actor and protected eligibility readback required'}


def release_ready(config, run_id, verify_id):
    installation_identity(config)
    context = release_context(config, verify_id)
    endpoint = f'repos/{REPO}'
    run = github(config, f'{endpoint}/actions/runs/{run_id}', release=True)
    require(run['workflow_id'] == config['deploy_workflow_id']
            and run['path'] == '.github/workflows/deploy.yml' and run['event'] == 'workflow_dispatch'
            and run['head_branch'] == 'main' and run['repository']['full_name'] == REPO
            and run['head_sha'] == context['source_sha']
            and run['display_title'] == dispatch_title(context['source_sha'], verify_id, context['acceptance_sha256']),
            'dispatch source/inputs/workflow mismatch')
    validate_dispatch_actor(run, config)
    reviewer = github(config, 'user', release=True)
    environment = github(config, f'{endpoint}/environments/production-release', release=True)
    validate_release_reviewer(environment, [run['actor']['id'], run['triggering_actor']['id']],
                              reviewer['id'], config)
    pending = github(config, f'{endpoint}/actions/runs/{run_id}/pending_deployments', release=True)
    require(pending and all(row['environment']['name'] == 'production-release'
                           and row['current_user_can_approve'] for row in pending),
            'independent production environment approval unavailable')
    return {**context, 'deploy_run': run_id,
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
    dispatch = commands.add_parser('dispatch-release')
    dispatch.add_argument('--verify-run', type=int, required=True)
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
        elif args.action == 'dispatch-release':
            result = dispatch_release(config, args.verify_run)
        else:
            result = release_ready(config, args.run, args.verify_run)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'[external-approval] refused: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
