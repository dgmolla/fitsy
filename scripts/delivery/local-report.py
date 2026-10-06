#!/usr/bin/env python3
"""One local publisher for UTC half-hour Fitsy delivery slots."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone


SLOT_SECONDS = 1800
GRACE_SECONDS = 120
MAX_AGE_SECONDS = 3600


def slot_key(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y-%m-%dT%H:%M')


def due_slots(now, activated):
    current = int(now // SLOT_SECONDS) * SLOT_SECONDS
    return [slot for slot in (current - SLOT_SECONDS, current)
            if slot >= int(activated // SLOT_SECONDS) * SLOT_SECONDS
            and slot + GRACE_SECONDS <= now and now - slot <= MAX_AGE_SECONDS]


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, sort_keys=True) + '\n')
    temporary.chmod(0o600)
    os.replace(temporary, path)


def post_once(slack, channel, slot, message, publisher_user, cursor='', seen=(), before_post=lambda: None):
    marker = f'fitsy-slot:{slot}'
    legacy = f'fitsy-hour:{slot[:13]}'
    oldest = str(int(datetime.strptime(slot, '%Y-%m-%dT%H:%M').replace(tzinfo=timezone.utc).timestamp()))
    page = slack.call('conversations.history', params={
        'channel': channel, 'oldest': oldest, 'limit': 200, **({'cursor': cursor} if cursor else {})})
    if not isinstance(page.get('messages'), list):
        raise RuntimeError('Slack history messages unavailable')
    for item in page['messages']:
        try:
            posted_at = float(item.get('ts', ''))
        except (TypeError, ValueError):
            posted_at = -1
        text = item.get('text') or ''
        if item.get('user') == publisher_user and (marker in text or
                (legacy in text and int(oldest) <= posted_at < int(oldest) + SLOT_SECONDS)):
            return {'state': 'delivered', 'duplicate': True, 'channel': channel,
                    'ts': item['ts'], 'marker': marker}
    next_cursor = page.get('response_metadata', {}).get('next_cursor', '')
    if next_cursor:
        if next_cursor in seen:
            raise RuntimeError('Slack history pagination did not advance')
        return {'state': 'scanning', 'cursor': next_cursor, 'seen': [*seen, next_cursor]}
    before_post()  # Durable pending intent clears the cursor before an uncertain Slack write.
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'fitsy-delivery:{channel}:{slot}'))
    try:
        result = slack.call('chat.postMessage', payload={
            'channel': channel, 'text': message, 'client_msg_id': identity,
            'unfurl_links': False, 'unfurl_media': False,
            'metadata': {'event_type': 'fitsy_delivery', 'event_payload': {'slot': slot}}})
    except Exception as error:
        error.post_attempted = True
        raise
    if result.get('channel') != channel or not result.get('ts'):
        error = RuntimeError('Slack post receipt is incomplete')
        error.post_attempted = True
        raise error
    return {'state': 'delivered', 'duplicate': False, 'channel': channel,
            'ts': result['ts'], 'marker': marker}


def safe_copy(value, limit):
    text = ' '.join(str(value or '').split())[:limit]
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def compose_update(report, state, slot, now=None):
    """Fresh coordinator prose, through the existing sole publisher."""
    now = time.time() if now is None else now
    path = state / 'editorial-update.json'
    try:
        update = json.loads(path.read_text())
        if not isinstance(update, dict) or not isinstance(update.get('authored_at'), str):
            raise ValueError('editorial timestamp must be a UTC string')
        authored = datetime.fromisoformat(update['authored_at'].replace('Z', '+00:00')).timestamp()
        bullets = update['bullets']
        if not 0 <= now - authored <= 45 * 60:
            raise ValueError('editorial update expired')
        if not isinstance(bullets, list) or not 3 <= len(bullets) <= 4:
            raise ValueError('expected three or four bullets')
        if any(not isinstance(line, str) or not line.strip() or len(line) > 220 or
               any(char in line for char in ('\n', '\r')) or '<@' in line or '<!' in line
               for line in bullets) or sum(map(len, bullets)) > 650:
            raise ValueError('editorial update exceeds compact notification bounds')
        current = {str(item['number']): item['status'] for item in report.get('editorialFacts', [])}
        bindings = update.get('board_bindings', {})
        if not isinstance(bindings, dict) or not bindings or any(
                current.get(str(number)) != status for number, status in bindings.items()):
            raise ValueError('editorial evidence no longer matches board')
        report['editorial'] = {'authored_at': update['authored_at'], 'board_bindings': bindings,
                               'state': 'fresh', 'bullets': bullets}
        lines = bullets
    except (OSError, KeyError, ValueError, TypeError):
        report['editorial'] = {'state': 'fallback'}
        facts = report.get('editorialFacts', [])
        active = [item for item in facts if item['status'] == 'In flight']
        ready = [item for item in facts if item['status'] == 'Queued' and not item.get('blocker')
                 and not item.get('dependencies') and not item.get('held')]
        lines = []
        if active:
            lines.append('Underway: ' + safe_copy(active[0]['title'], 120) + '. Acceptance is still pending.')
        else:
            lines.append('No delivery worker is marked active on the board; execution needs reconciliation.'
                         if ready else 'No delivery worker is marked active; queued eligibility needs reconciliation.')
        if report.get('summary', {}).get('shipped'):
            lines.append('Recently verified: ' + safe_copy(report['summary']['shipped'][0]['title'], 120) + '.')
        elif ready:
            lines.append('Queued without a recorded hold: ' + safe_copy(ready[0]['title'], 120) + '. Eligibility still needs confirmation.')
        else:
            lines.append('No new verified shipment in the last 24 hours.')
        blockers = [item for item in facts if item.get('blocker') and item['status'] == 'In flight']
        if blockers:
            lines.append('Current execution obstacle: ' + safe_copy(blockers[0]['blocker'], 150))
        else:
            lines.append('Fresh coordinator context is unavailable; no new human request is inferred from old backlog blockers.')
    marker = f'https://github.com/users/dgmolla/projects/1#fitsy-slot:{slot}'
    return f'*Fitsy {slot[11:]} UTC* · <{marker}|Details>\n' + '\n'.join('• ' + line for line in lines)


class QueueReportDeferred(RuntimeError):
    def __init__(self, retry_at, reason):
        self.retry_at = retry_at
        super().__init__(reason)


def project_snapshot():
    """The sole publisher uses the dispatcher's complete reader and shared cooldown."""
    config = Path(os.environ.get('FITSY_DISPATCHER_CONFIG',
                                 str(Path.home() / '.fitsy-dispatcher/config.json'))).expanduser()
    runtime = config.parent / 'runtime/local-dispatcher.py'
    result = subprocess.run([sys.executable, str(runtime), 'snapshot', '--config', str(config)],
                            capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError('canonical report queue snapshot failed')
    value = json.loads(result.stdout)
    if value.get('state') == 'queue-read-backoff':
        retry = datetime.fromisoformat(value['retry_at'].replace('Z', '+00:00')).timestamp()
        raise QueueReportDeferred(retry, 'GitHub report deferred by shared queue cooldown')
    if value.get('state') == 'busy':
        raise QueueReportDeferred(time.time() + 60, 'Dispatcher owns queue reader; report deferred')
    items = value.get('items')
    total = value.get('totalCount')
    if (type(total) is not int or not isinstance(items, list) or len(items) != total or
            any(not isinstance(item, dict) or not item.get('id') for item in items) or
            len({item['id'] for item in items}) != total):
        raise RuntimeError('canonical report queue snapshot incomplete')
    return {**value, 'observed_at': datetime.now(timezone.utc).isoformat()}


def generate_report(runtime, state, slot, timing_roots):
    snapshot = project_snapshot()
    token = subprocess.check_output(['gh', 'auth', 'token'], text=True, timeout=30).strip()
    if not token:
        raise RuntimeError('GitHub token unavailable')
    output = state / 'reports' / slot.replace(':', '-')
    save(output / 'project-snapshot.json', snapshot)
    environment = {**os.environ, 'GITHUB_TOKEN': token, 'DELIVERY_GITHUB_TOKEN': token,
                   'FITSY_LOCAL_TIMING_ROOTS': json.dumps(timing_roots)}
    result = subprocess.run(['node', str(runtime / 'hourly-report.mjs'), '--output-dir', str(output),
                             f'--slot={slot}', '--dry-run',
                             f'--project-snapshot={output / "project-snapshot.json"}'], env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    if result.returncode:
        raise RuntimeError(f'report collection failed: {result.stderr.strip()[:300]}')
    report = json.loads((output / 'report.json').read_text())
    if report.get('slotKey') != slot:
        raise RuntimeError('report slot identity mismatch')
    message = compose_update(report, state, slot)
    save(output / 'report.json', report)
    (output / 'report.txt').write_text(message + '\n')
    return message


def run_once(config, state, slack, now=None, generator=generate_report):
    now = time.time() if now is None else now
    runtime = Path(__file__).resolve().parent
    for epoch in due_slots(now, config['activated_at']):
        slot = slot_key(epoch)
        path = state / 'slots' / f'{slot.replace(":", "-")}.json'
        prior = json.loads(path.read_text()) if path.exists() else {}
        if prior.get('state') == 'delivered' or prior.get('next_attempt', 0) > now:
            continue
        try:
            message = generator(runtime, state, slot, config.get('timing_roots', []))
            receipt = post_once(slack, config['channel'], slot, message, config['user'],
                                prior.get('cursor', ''), prior.get('seen', []),
                                lambda: save(path, {'slot': slot, 'state': 'pending',
                                                    'next_attempt': now + 60, 'post_intent': True}))
            if receipt['state'] == 'scanning':
                save(path, {**receipt, 'slot': slot, 'next_attempt': now + 60})
                continue
            save(path, {**receipt, 'slot': slot, 'confirmed_at': now})
            print(json.dumps({'slot': slot, **receipt}))
        except Exception as error:
            retry_at = max(now + 60, getattr(error, 'retry_at', 0))
            continuation = {} if getattr(error, 'post_attempted', False) else {
                key: prior[key] for key in ('cursor', 'seen') if key in prior}
            save(path, {'slot': slot, 'state': 'pending', 'next_attempt': retry_at, **continuation,
                        'attempts': prior.get('attempts', 0) + 1,
                        'error': str(error)[:200]})
            print(json.dumps({'slot': slot, 'state': 'pending', 'retry_at': retry_at,
                              'error': str(error)[:200]}), file=sys.stderr)
            if getattr(error, 'retry_at', 0):
                break  # Shared Slack limiter said to wait; do not try another slot now.


def main():
    state = Path(os.environ['FITSY_DELIVERY_STATE']).expanduser().resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'publisher.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('delivery publisher already running')
            return
        config = json.loads((state / 'config.json').read_text())
        sys.path.insert(0, config['bridge_path'])
        import bridge
        bridge.load_env()
        settings = bridge.Config.from_env()
        if settings.channel != config['channel']:
            raise RuntimeError('Slack channel does not match shared limiter configuration')
        slack = bridge.Slack(bridge.Store(settings))
        identity = slack.call('auth.test')
        if identity.get('user_id') != config['user']:
            raise RuntimeError('Slack token user does not match configured publisher')
        run_once(config, state, slack)


if __name__ == '__main__':
    main()
