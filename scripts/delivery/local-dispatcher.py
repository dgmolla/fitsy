#!/usr/bin/env python3
"""Single-host, board-backed Codex dispatcher. One tick is one bounded decision."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
import urllib.request
import uuid


def incident(state, claim, reason):
    key = f"fitsy-blocker:{claim['issue']}:{claim['id']}"
    state.setdefault('alerts', {})[key] = {'issue': claim['issue'], 'reason': reason[:180],
                                           'since': utc(), 'state': 'pending', 'next_attempt': 0}


def resolve_incidents(state, issue):
    for key, alert in list((state.get('alerts') or {}).items()):
        if alert['issue'] == issue and alert['state'] == 'delivered' and key.startswith('fitsy-blocker:'):
            resolution = f'fitsy-resolved:{key}'
            if resolution not in state['alerts']:
                state['alerts'][resolution] = {'issue': issue, 'reason': 'Verified delivery completed; blocker cleared.',
                                               'since': utc(), 'state': 'pending', 'next_attempt': 0}


def deliver_alerts(config, state, state_path):
    """Reconcile an uncertain Slack send before posting via the shared rate limiter."""
    alerts = state.get('alerts') or {}
    due = [(key, alert) for key, alert in alerts.items()
           if alert['state'] != 'delivered' and alert.get('next_attempt', 0) <= time.time()]
    if not due or not config.get('slack'):
        return
    slack_config = config['slack']
    sys.path.insert(0, slack_config['bridge_path'])
    import bridge
    bridge.load_env()
    settings = bridge.Config.from_env()
    if settings.channel != slack_config['channel']:
        raise RuntimeError('blocker channel differs from shared Slack limiter')
    slack = bridge.Slack(bridge.Store(settings))
    identity = slack.call('auth.test')
    if identity.get('user_id') != slack_config['sender']:
        raise RuntimeError('blocker sender identity mismatch')
    for key, alert in due[:1]:
        try:
            cursor = ''
            seen = set()
            oldest = str(int(datetime.fromisoformat(alert['since'].replace('Z', '+00:00')).timestamp()))
            while True:
                page = slack.call('conversations.history', params={
                    'channel': slack_config['channel'], 'oldest': oldest, 'limit': 200,
                    **({'cursor': cursor} if cursor else {})})
                if not isinstance(page.get('messages'), list):
                    raise RuntimeError('Slack history unavailable')
                match = next((msg for msg in page['messages'] if msg.get('user') == slack_config['sender']
                              and key in (msg.get('text') or '')), None)
                if match:
                    alert.update({'state': 'delivered', 'ts': match['ts'], 'duplicate': True})
                    break
                cursor = page.get('response_metadata', {}).get('next_cursor', '')
                if not cursor:
                    alert.update({'state': 'post-intent', 'next_attempt': time.time() + 60})
                    write_json(state_path, state)
                    if key.startswith('fitsy-resolved:'):
                        message = (f"✅ *RESOLVED* Fitsy #{alert['issue']}\n"
                                   f"{alert['reason']}\n"
                                   f"<https://github.com/dgmolla/fitsy/issues/{alert['issue']}|Issue> {key}")
                    else:
                        message = (f"🚨 *BLOCKED* <@{slack_config['recipient']}> Fitsy #{alert['issue']}\n"
                                   f"{alert['reason']}\n"
                                   f"Next: inspect and resolve <https://github.com/dgmolla/fitsy/issues/{alert['issue']}|issue>. {key}")
                    receipt = slack.call('chat.postMessage', payload={
                        'channel': slack_config['channel'], 'text': message,
                        'client_msg_id': str(uuid.uuid5(uuid.NAMESPACE_URL, key)),
                        'unfurl_links': False, 'unfurl_media': False})
                    if receipt.get('channel') != slack_config['channel'] or not receipt.get('ts'):
                        raise RuntimeError('Slack blocker receipt incomplete')
                    alert.update({'state': 'delivered', 'ts': receipt['ts'], 'duplicate': False})
                    break
                if cursor in seen:
                    raise RuntimeError('Slack pagination did not advance')
                seen.add(cursor)
            write_json(state_path, state)
        except Exception as error:
            alert.update({'state': 'pending', 'next_attempt': max(time.time() + 60, getattr(error, 'retry_at', 0)),
                          'error': type(error).__name__})
            write_json(state_path, state)
            return

PROJECT_ID = 'PVT_kwHOARmQNM4BkyAY'
STATUS_FIELD = 'PVTSSF_lAHOARmQNM4BkyAYzhjhV10'
IN_FLIGHT = '47fc9ee4'
QUEUED = 'f75ad846'
PROGRESS_FIELD = 'PVTF_lAHOARmQNM4BkyAYzhjhdPg'
STARTED_FIELD = 'PVTF_lAHOARmQNM4BkyAYzhjhdPc'
BLOCKER_FIELD = 'PVTF_lAHOARmQNM4BkyAYzhjhWMY'
PROMPT_VERSION = 'dispatch-v1'
JEV_MODEL = 'jev-latest'
MIN_CONFIDENCE = 0.6
DEPENDENCIES = re.compile(r'^\s*#\d+(?:\s*,\s*#\d+)*\s*$')
RISK = {'low': 0, 'medium': 1, 'high': 2}
QUESTIONS = {
    'task_type': {'type': 'choice', 'instructions': 'Classify the requested work, not its authority or readiness.',
                  'criteria': {'bugfix': 'Repair an observed malfunction.', 'implementation': 'Implement requested behavior.',
                               'documentation': 'Change documentation or process wording only.', 'investigation': 'Diagnose before a fix is known.'}},
    'risk': {'type': 'choice', 'instructions': 'Estimate implementation planning risk; never decide review gates.',
             'criteria': {'low': 'Local or documentation change with narrow effect.',
                          'medium': 'Cross-component or operational behavior with recoverable impact.',
                          'high': 'Security, data, production, credentials, migrations or broad irreversible impact.'}},
    'profile': {'type': 'choice', 'instructions': 'Select a configured implementation effort, not a provider, permission or reviewer.',
                'criteria': {'standard': 'Default capable implementation effort.',
                             'deep': 'More reasoning for complex or protected implementation.'}},
}


def utc(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix=path.name + '.', delete=False) as out:
        json.dump(value, out, sort_keys=True)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())
        temporary = Path(out.name)
    temporary.chmod(0o600)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def command(argv, *, timeout=30, input_text=None, cwd=None):
    result = subprocess.run(argv, input=input_text, text=True, capture_output=True, timeout=timeout, cwd=cwd)
    if result.returncode:
        raise RuntimeError(f'{Path(argv[0]).name} {argv[1:3]} failed ({result.returncode}): {result.stderr[-300:]}')
    return result.stdout


def gh(config, *args, timeout=30):
    return command([config['gh_bin'], *args], timeout=timeout)


def board(config):
    data = json.loads(gh(config, 'project', 'item-list', '1', '--owner', 'dgmolla', '--limit', '10000', '--format', 'json'))
    items = data.get('items')
    if not isinstance(items, list) or data.get('totalCount') != len(items):
        raise RuntimeError('GitHub project pagination incomplete; refusing dispatch')
    return items


def ready_event(config, number):
    lines = gh(config, 'api', f'repos/dgmolla/fitsy/issues/{number}/events?per_page=100', '--paginate',
               '--jq', '.[] | select(.event=="labeled" and .label.name=="dispatch-ready") | .created_at').splitlines()
    return max(lines) if lines else None


def terminal_verified(config, item):
    """Board state is only a hint; independently bind acceptance to merged main CI."""
    if item.get('status') != 'Done' or not item.get('verified at'):
        return False
    number = item['content']['number']
    issue = json.loads(gh(config, 'issue', 'view', str(number), '-R', 'dgmolla/fitsy', '--json', 'state'))
    if issue.get('state') != 'CLOSED':
        return False
    lines = gh(config, 'api', f'repos/dgmolla/fitsy/issues/{number}/comments?per_page=100', '--paginate',
               '--jq', '.[] | {id,body} | @json').splitlines()
    marker = '<!-- fitsy-dispatch-terminal:v1 -->'
    for line in reversed(lines):
        body = json.loads(line).get('body') or ''
        if marker not in body:
            continue
        try:
            receipt = json.loads(body.split(marker, 1)[1].strip())
            if receipt.get('acceptance') != 'verified' or not re.fullmatch(r'[0-9a-f]{40}', receipt['merge_sha']):
                return False
            pr = json.loads(gh(config, 'pr', 'view', str(receipt['pr']), '-R', 'dgmolla/fitsy',
                               '--json', 'state,mergeCommit,headRefOid'))
            if pr.get('state') != 'MERGED' or pr.get('mergeCommit', {}).get('oid') != receipt['merge_sha'] or pr.get('headRefOid') != receipt['head_sha']:
                return False
            runs = json.loads(gh(config, 'run', 'list', '-R', 'dgmolla/fitsy', '--branch', 'main', '--limit', '100',
                                 '--json', 'workflowName,headSha,status,conclusion,databaseId'))
            if all(any(run.get('workflowName') == name and run.get('headSha') == receipt['merge_sha']
                       and run.get('status') == 'completed' and run.get('conclusion') == 'success'
                       and run.get('databaseId') == receipt.get(field) for run in runs)
                   for name, field in (('Verify', 'verify_run'), ('Deploy', 'deploy_run'))):
                return True
            return False
        except (KeyError, ValueError, TypeError, RuntimeError):
            return False
    return False


def eligible(items, readiness, readiness_source, config):
    by_number = {item.get('content', {}).get('number'): item for item in items
                 if item.get('content', {}).get('repository') == 'dgmolla/fitsy'}
    candidates = []
    for item in items:
        content = item.get('content') or {}
        number = content.get('number')
        if not isinstance(number, int) or content.get('type') != 'Issue' or content.get('repository') != 'dgmolla/fitsy':
            continue
        labels = set(item.get('labels') or [])
        if item.get('status') != 'Queued' or item.get('priority') not in ('Now', 'Next'):
            continue
        if 'dispatch-ready' not in labels or 'dispatch-hold' in labels or item.get('blocker'):
            continue
        deps = (item.get('dependencies') or '').strip()
        if deps:
            if not DEPENDENCIES.fullmatch(deps):
                continue
            numbers = [int(value) for value in re.findall(r'#(\d+)', deps)]
            if number in numbers or any(not by_number.get(dep) or not terminal_verified(config, by_number[dep])
                                        for dep in numbers):
                continue
        event = ready_event(config, number)
        timestamp = event or readiness.get(str(number)) or utc()
        readiness[str(number)] = timestamp
        readiness_source[str(number)] = 'label-event' if event else readiness_source.get(str(number), 'first-observed')
        candidates.append((0 if item['priority'] == 'Now' else 1, timestamp, number, item))
    return [entry[-1] for entry in sorted(candidates)]


def bounded_input(item):
    content = item['content']
    return {'issue': content['number'], 'title': content.get('title', '')[:240],
            'body': content.get('body', '')[:4000], 'labels': sorted(item.get('labels') or []),
            'priority': item.get('priority')}


def risk_floor(value):
    labels = set(value['labels'])
    title = value['title'].lower()
    if labels.intersection({'security', 'data-integrity', 'migration', 'risk-high'}) or any(
            word in title for word in ('credential', 'production migration', 'security', 'data loss')):
        return 'high'
    return 'medium' if labels.intersection({'infrastructure', 'risk-medium'}) else 'low'


def credential(path):
    if not path:
        raise RuntimeError('Jev credential path unavailable')
    source = Path(path).expanduser().resolve()
    if not source.is_file() or source.stat().st_uid != os.getuid() or source.stat().st_mode & 0o077:
        raise RuntimeError('Jev credential file must be owned and private')
    for line in source.read_text().splitlines():
        match = re.fullmatch(r'\s*(?:export\s+)?jev\s*=\s*(["\']?)([^"\']+)\1\s*', line)
        if match:
            return match.group(2)
    raise RuntimeError('Jev credential not found')


def jev(value, key_path, endpoint='https://api.typesafe.ai/v1/systemone'):
    request = {'model': JEV_MODEL, 'state': {'task': value}, 'questions': QUESTIONS}
    token = credential(key_path)
    call = urllib.request.Request(endpoint, json.dumps(request).encode(),
                                  {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    start = time.monotonic()
    with urllib.request.urlopen(call, timeout=5) as response:
        result = json.load(response)
    latency_ms = round((time.monotonic() - start) * 1000)
    answers = result.get('answers')
    if not isinstance(answers, dict) or set(answers) != set(QUESTIONS):
        raise RuntimeError('Jev answer shape invalid')
    chosen = {}
    for name, question in QUESTIONS.items():
        answer = answers[name]
        if not isinstance(answer, dict) or answer.get('choice') not in question['criteria'] or not isinstance(answer.get('confidence'), (float, int)):
            raise RuntimeError('Jev choice invalid')
        if not 0 <= answer['confidence'] <= 1:
            raise RuntimeError('Jev confidence invalid')
        probabilities = answer.get('probabilities')
        if not isinstance(probabilities, dict) or set(probabilities) != set(question['criteria']):
            raise RuntimeError('Jev probabilities invalid')
        if not all(isinstance(p, (int, float)) and 0 <= p <= 1 for p in probabilities.values()) or not 0.99 <= sum(probabilities.values()) <= 1.01:
            raise RuntimeError('Jev probabilities invalid')
        chosen[name] = {'choice': answer['choice'], 'confidence': answer['confidence'],
                        'accepted': answer['confidence'] >= MIN_CONFIDENCE}
    return {'source': 'jev', 'model_requested': JEV_MODEL, 'model_returned': result.get('model'),
            'latency_ms': latency_ms, 'answers': chosen}


def classify(config, state, item):
    value = bounded_input(item)
    digest = hashlib.sha256(json.dumps({'version': PROMPT_VERSION, 'model': JEV_MODEL,
                                       'profiles': config['profiles'], 'value': value}, sort_keys=True).encode()).hexdigest()
    cached = state.setdefault('classifications', {}).get(digest)
    if cached:
        return digest, cached
    floor = risk_floor(value)
    started = time.monotonic()
    try:
        result = jev(value, config.get('jev_key_file'), config.get('jev_endpoint', 'https://api.typesafe.ai/v1/systemone'))
        answers = result['answers']
        advised = answers['risk']['choice'] if answers['risk']['accepted'] else None
        risk = max((floor, advised), key=RISK.get) if advised else ('unknown' if floor == 'low' else floor)
        profile = answers['profile']['choice'] if answers['profile']['accepted'] else 'standard'
        if risk == 'high':
            profile = 'deep'
        result.update({'task_type': answers['task_type']['choice'] if answers['task_type']['accepted'] else 'unknown', 'planning_risk': risk,
                       'floor': floor, 'profile': profile})
    except Exception as error:
        result = {'source': 'deterministic-fallback', 'reason': type(error).__name__,
                  'model_requested': JEV_MODEL, 'model_returned': None,
                  'latency_ms': round((time.monotonic() - started) * 1000),
                  'task_type': 'implementation', 'planning_risk': 'unknown' if floor == 'low' else floor,
                  'floor': floor, 'profile': 'deep' if floor == 'high' else 'standard'}
    state['classifications'][digest] = result
    return digest, result


def edit_item(config, item_id, field, *, text=None, option=None, clear=False):
    args = ['project', 'item-edit', '--id', item_id, '--project-id', PROJECT_ID, '--field-id', field]
    if clear:
        args.append('--clear')
    elif text is not None:
        args.extend(['--text', text])
    else:
        args.extend(['--single-select-option-id', option])
    gh(config, *args)


def pid_identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def group_alive(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def make_prompt(claim):
    task = claim['input']
    return (f"Deliver Fitsy issue #{task['issue']}: {task['title']}\n\n{task['body']}\n\n"
            'You are the only implementation owner for this issue. Work only in this isolated checkout. '
            'Read AGENTS.md, package instructions, docs/engineering/devops/task-management.md, shipping.md, '
            'and the ship-branch skill. Bind the issue phase-events before edits. Reproduce the actual bug before fixing it. '
            'Use canonical exact-head tests and independent reviews with retained issue budget, then authorized push/PR/merge, '
            'main Verify and Deploy, actual acceptance, issue and board closeout. Preserve P0/P1 gates and review history. '
            'Do not start another issue, restart FM, change unrelated source, or send a second periodic Slack digest. '
            'Report blockers on this issue with a stable incident key; the dispatcher owns any Slack blocker alert. '
            f"Planning classification is advisory: {claim['classification']['task_type']}, "
            f"risk {claim['classification']['planning_risk']}, profile {claim['classification']['profile']}. "
            f"The configured implementation provider/model is {claim['worker_profile']['provider']}/"
            f"{claim['worker_profile']['model']}; record actual use. "
            f"Use independent canonical reviews with the snapshotted reviewer provider/model "
            f"{claim['review_profile']['provider']}/{claim['review_profile']['model']} "
            f"at {claim['review_profile']['effort']} effort. "
            'The canonical diff-based review tier is authoritative. '
            'At completion, set board Verified at and Done only after acceptance, then post exactly one issue comment '
            'starting `<!-- fitsy-dispatch-terminal:v1 -->` followed by compact JSON containing '
            '`{"pr":number,"head_sha":"40-hex","merge_sha":"40-hex","verify_run":number,"deploy_run":number,"acceptance":"verified"}`. '
            'The dispatcher independently checks the merged PR and successful main Verify and Deploy run IDs at the merge SHA; '
            'missing evidence does not satisfy dependencies. '
            'if blocked, add dispatch-hold with a concrete reason and stop. '
            'Before expensive checks, confirm both root and workspace-local dependencies match the lockfile and generated schema; '
            'reuse only a verified matching seed and never mutate shared dependencies. '
            'The user authorizes the existing 1800-second cumulative independent-review budget plus at most one durable '
            '900-second extension through the shipped budget tool when required; retain every historical attempt. '
            'Do not ask again for that extension or waive a required lens. '
            'If the authorized total cannot finish mandatory review, park with evidence and release the lane.\n')


def archive(state, claim, status, state_path):
    claim['terminal'] = status
    claim['reconciled_at'] = utc()
    write_json(state_path.parent / 'claims' / claim['id'] / 'receipt.json', claim)
    state.setdefault('history', []).append(claim)
    state['history'] = state['history'][-100:]
    state['active'] = None


def tick(config, state, state_path, script):
    try:
        deliver_alerts(config, state, state_path)
    except Exception:
        pass  # A notification fault never changes claim ownership or queue decisions.
    active = state.get('active')
    if active:
        if active.get('stage') == 'ownership-uncertain':
            return {'state': 'ownership-uncertain', 'issue': active['issue']}
        if active.get('stage') in ('launching', 'running') and not active.get('pid'):
            return {'state': 'uncertain-launch', 'issue': active['issue']}
        if active.get('pid') and active.get('pid_started') and pid_identity(active['pid']) not in (None, active['pid_started']):
            return {'state': 'uncertain-pid-reuse', 'issue': active['issue']}
        if active.get('pid') and active.get('finished_at') and group_alive(active['pid']):
            return {'state': 'worker-group-live', 'issue': active['issue']}
        if active.get('pid') and not active.get('finished_at'):
            observed = pid_identity(active['pid'])
            if observed == active.get('pid_started'):
                return {'state': 'running', 'issue': active['issue'], 'pid': active['pid']}
            if not active.get('pid_started'):
                return {'state': 'uncertain-pid', 'issue': active['issue']}
            if group_alive(active['pid']):
                return {'state': 'worker-group-live', 'issue': active['issue']}
            active['finished_at'] = utc()
            active['exit_code'] = None
            active['failure'] = 'worker ended without an exit receipt'
            write_json(state_path, state)
        if active.get('stage') in ('prepared', 'remote-claimed'):
            # These stages precede launcher creation; the lock excludes another tick.
            items = board(config)
            item = next((entry for entry in items if entry.get('content', {}).get('number') == active['issue']), None)
            if not item:
                return {'state': 'uncertain-claim', 'issue': active['issue']}
            reason = f"Pre-launch claim {active['id']} stopped; inspect remote update or worktree preparation"
            gh(config, 'issue', 'edit', str(active['issue']), '-R', 'dgmolla/fitsy', '--add-label', 'dispatch-hold')
            edit_item(config, item['id'], STATUS_FIELD, option=QUEUED)
            edit_item(config, item['id'], BLOCKER_FIELD, text=reason)
            state.setdefault('parked', {})[str(active['issue'])] = active['ready_at']
            incident(state, active, reason)
            archive(state, active, 'parked-prelaunch', state_path)
            write_json(state_path, state)
            try:
                deliver_alerts(config, state, state_path)
            except Exception:
                pass
            active = None
        if active:
            items = board(config)
            item = next((entry for entry in items if entry.get('content', {}).get('number') == active['issue']), None)
            if item and terminal_verified(config, item):
                resolve_incidents(state, active['issue'])
                archive(state, active, 'verified', state_path)
                write_json(state_path, state)
            elif item and item.get('status') == 'Queued' and 'dispatch-hold' in (item.get('labels') or []):
                incident(state, active, str(item.get('blocker') or 'Worker parked delivery; inspect the issue handoff'))
                archive(state, active, 'parked-by-worker', state_path)
                write_json(state_path, state)
            else:
                reason = active.get('failure') or f"Worker exited with code {active.get('exit_code')}; verified Done was not recorded"
                if item:
                    gh(config, 'issue', 'edit', str(active['issue']), '-R', 'dgmolla/fitsy', '--add-label', 'dispatch-hold')
                    edit_item(config, item['id'], STATUS_FIELD, option=QUEUED)
                    edit_item(config, item['id'], BLOCKER_FIELD, text=reason[:500])
                    edit_item(config, item['id'], PROGRESS_FIELD, text=f"Dispatcher parked claim {active['id']}; inspect private worker output and issue evidence.")
                state.setdefault('parked', {})[str(active['issue'])] = active['ready_at']
                incident(state, active, reason)
                archive(state, active, 'parked-after-exit', state_path)
                write_json(state_path, state)
                try:
                    deliver_alerts(config, state, state_path)
                except Exception:
                    pass
    if not config.get('enabled'):
        return {'state': 'disabled'}
    if shutil.disk_usage(config['worktree_root']).free < config.get('min_free_bytes', 8 * 1024**3):
        return {'state': 'resource-hold', 'reason': 'disk below configured minimum'}
    items = board(config)
    candidates = eligible(items, state.setdefault('readiness', {}), state.setdefault('readiness_source', {}), config)
    for item in candidates:
        number = item['content']['number']
        if state.setdefault('parked', {}).get(str(number)) == state['readiness'][str(number)]:
            continue
        issue = json.loads(gh(config, 'issue', 'view', str(number), '-R', 'dgmolla/fitsy',
                              '--json', 'state,title,body,url'))
        if issue['state'] != 'OPEN':
            continue
        if not isinstance(issue.get('body'), str) or len(issue['body']) > 100_000:
            raise RuntimeError('issue acceptance is missing or exceeds the safe prompt bound')
        frozen_item = {**item, 'content': {**item['content'], 'title': issue['title'], 'body': issue['body']}}
        digest, classification = classify(config, state, frozen_item)
        claim_id = str(uuid.uuid4())
        ready_at = state['readiness'][str(number)]
        claimed_at = utc()
        queue_wait = max(0, round((datetime.fromisoformat(claimed_at.replace('Z', '+00:00')) -
                                   datetime.fromisoformat(ready_at.replace('Z', '+00:00'))).total_seconds())) if state['readiness_source'][str(number)] == 'label-event' else None
        claim = {'id': claim_id, 'issue': number, 'item_id': item['id'], 'ready_at': state['readiness'][str(number)],
                 'ready_source': state['readiness_source'][str(number)], 'queue_wait_seconds': queue_wait,
                 'claimed_at': claimed_at, 'stage': 'prepared', 'input_sha256': digest,
                 'input': {'issue': number, 'title': issue['title'], 'body': issue['body'], 'url': issue['url']},
                 'classification': classification,
                 'worker_profile': dict(config['profiles'][classification['profile']]),
                 'review_profile': dict(config['review'])}
        state['active'] = claim
        write_json(state_path, state)  # Durable local claim precedes every remote claim and process.
        edit_item(config, item['id'], STATUS_FIELD, option=IN_FLIGHT)
        if not item.get('started at'):
            edit_item(config, item['id'], STARTED_FIELD, text=claim['claimed_at'])
        edit_item(config, item['id'], PROGRESS_FIELD, text=f"Local Codex dispatcher claim {claim_id}; worker launch pending.")
        gh(config, 'issue', 'comment', str(number), '-R', 'dgmolla/fitsy', '--body', f"<!-- fitsy-dispatch-claim:v1:{claim_id} -->\nClaimed by the single-host local delivery dispatcher at {claim['claimed_at']}; classification {classification['source']} ({classification['profile']}); worker {claim['worker_profile']['provider']}/{claim['worker_profile']['model']}.")
        confirmed = next((entry for entry in board(config) if entry.get('content', {}).get('number') == number), None)
        if not confirmed or confirmed.get('status') != 'In flight':
            return {'state': 'uncertain-remote-claim', 'issue': number}
        claim['stage'] = 'remote-claimed'
        write_json(state_path, state)
        worktree = Path(config['worktree_root']) / f'fitsy-issue-{number}-{claim_id[:8]}'
        branch = f'codex/issue-{number}-{claim_id[:8]}'
        try:
            command([config['git_bin'], '-C', config['repo_root'], 'fetch', 'origin', 'main'], timeout=60)
            command([config['git_bin'], '-C', config['repo_root'], 'worktree', 'add', '-b', branch, str(worktree), 'origin/main'], timeout=60)
        except Exception as error:
            reason = f"Worktree preparation failed ({type(error).__name__}); inspect claim {claim_id}"
            gh(config, 'issue', 'edit', str(number), '-R', 'dgmolla/fitsy', '--add-label', 'dispatch-hold')
            edit_item(config, item['id'], STATUS_FIELD, option=QUEUED)
            edit_item(config, item['id'], BLOCKER_FIELD, text=reason)
            state.setdefault('parked', {})[str(number)] = claim['ready_at']
            incident(state, claim, reason)
            archive(state, claim, 'parked-setup-failure', state_path)
            write_json(state_path, state)
            try:
                deliver_alerts(config, state, state_path)
            except Exception:
                pass
            return {'state': 'parked-setup-failure', 'issue': number}
        claim.update({'worktree': str(worktree), 'branch': branch, 'stage': 'launching'})
        claim_dir = Path(config['state_dir']) / 'claims' / claim_id
        claim_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        claim['prompt_path'] = str(claim_dir / 'prompt.txt')
        claim['output_path'] = str(claim_dir / 'worker.jsonl')
        (claim_dir / 'prompt.txt').write_text(make_prompt(claim))
        (claim_dir / 'prompt.txt').chmod(0o600)
        write_json(state_path, state)
        with (claim_dir / 'launcher.log').open('a') as log:
            subprocess.Popen([sys.executable, str(script), 'worker', '--config', config['_path'], '--claim-id', claim_id],
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        return {'state': 'launching', 'issue': number, 'claim': claim_id}
    write_json(state_path, state)
    return {'state': 'idle', 'candidates': 0}


def worker(config, state_path, lock_path, claim_id):
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = read_json(state_path, {})
        claim = state.get('active')
        if not claim or claim['id'] != claim_id or claim['stage'] != 'launching':
            raise RuntimeError('worker claim identity changed')
        claim['stage'] = 'running'
        claim['launcher_pid'] = os.getpid()
        claim['launcher_started'] = pid_identity(os.getpid())
        write_json(state_path, state)
    worktree = claim['worktree']
    profile = claim['worker_profile']
    if profile['provider'] == 'codex':
        args = [profile['executable'], 'exec', '--json', '--model', profile['model'], '-C', worktree,
                '--sandbox', 'danger-full-access', '-c', 'approval_policy="never"',
                '-c', f'model_reasoning_effort="{profile["effort"]}"', '--disable', 'multi_agent',
                '--output-last-message', str(Path(claim['output_path']).with_name('last-message.txt')), '-']
    elif profile['provider'] == 'claude':
        args = [profile['executable'], '--print', '--verbose', '--output-format', 'stream-json',
                '--model', profile['model'], '--effort', profile['effort'],
                '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none',
                '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                '--settings', '{"disableAllHooks":true}']
    else:
        raise RuntimeError('unsupported configured worker provider')
    if config.get('test_pause_before_child_seconds'):
        time.sleep(config['test_pause_before_child_seconds'])
    review = claim['review_profile']
    environment = {**os.environ, 'FITSY_REVIEW_PROVIDER': review['provider'],
                   'FITSY_REVIEW_MODEL': review['model'], 'FITSY_REVIEW_REASONING_EFFORT': review['effort']}
    with open(claim['prompt_path']) as prompt, open(claim['output_path'], 'a') as output:
        child = subprocess.Popen(args, stdin=prompt, stdout=output, stderr=subprocess.STDOUT, cwd=worktree,
                                 env=environment, start_new_session=True)
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = read_json(state_path, {})
            if not state.get('active') or state['active']['id'] != claim_id:
                raise RuntimeError('worker claim lost after spawn')
            state['active']['pid'] = child.pid
            state['active']['pid_started'] = pid_identity(child.pid)
            state['active']['started_at'] = utc()
            write_json(state_path, state)
        try:
            code = child.wait(timeout=config.get('worker_timeout_seconds', 90 * 60))
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                code = child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                code = child.wait(timeout=10)
        remaining_group = group_alive(child.pid)
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = read_json(state_path, {})
        if state.get('active') and state['active']['id'] == claim_id:
            state['active']['finished_at'] = utc()
            state['active']['exit_code'] = code
            state['active']['timed_out'] = timed_out
            if timed_out:
                state['active']['failure'] = f"worker exceeded {config.get('worker_timeout_seconds', 90 * 60)}s wall-clock budget"
            if remaining_group:
                state['active']['stage'] = 'ownership-uncertain'
            write_json(state_path, state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('tick', 'status', 'worker'))
    parser.add_argument('--config', required=True)
    parser.add_argument('--claim-id')
    args = parser.parse_args()
    path = Path(args.config).expanduser().resolve()
    if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise RuntimeError('dispatcher config must be owned and private')
    config = json.loads(path.read_text())
    for name in ('standard', 'deep'):
        profile = config.get('profiles', {}).get(name)
        if not isinstance(profile, dict) or profile.get('provider') not in ('codex', 'claude') or not isinstance(profile.get('model'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}', profile['model']):
            raise RuntimeError(f'invalid {name} worker profile')
        if profile.get('effort') not in ('low', 'medium', 'high', 'xhigh') or not Path(profile.get('executable', '')).is_absolute() or not Path(profile['executable']).is_file():
            raise RuntimeError(f'invalid {name} worker executable or effort')
    review = config.get('review')
    if not isinstance(review, dict) or review.get('provider') not in ('codex', 'claude') or not isinstance(review.get('model'), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}', review['model']) or review.get('effort') not in ('low', 'medium', 'high', 'xhigh'):
        raise RuntimeError('invalid independent reviewer configuration')
    config['_path'] = str(path)
    state_dir = Path(config['state_dir']).expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_path = state_dir / 'state.json'
    lock_path = state_dir / 'dispatcher.lock'
    if args.mode == 'worker':
        if not args.claim_id:
            parser.error('worker requires --claim-id')
        worker(config, state_path, lock_path, args.claim_id)
        return
    if args.mode == 'status':
        state = read_json(state_path, {})
        active = state.get('active')
        print(json.dumps({'enabled': config.get('enabled'),
                          'active': {k: active.get(k) for k in ('id', 'issue', 'stage', 'pid', 'started_at', 'finished_at')}
                          if active else None, 'parked_issues': sorted(state.get('parked', {}))}))
        return
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'state': 'busy'}))
            return
        state = read_json(state_path, {'version': 1, 'active': None, 'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []})
        print(json.dumps(tick(config, state, state_path, Path(__file__).resolve())))


if __name__ == '__main__':
    main()
