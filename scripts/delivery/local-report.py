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


def post_once(slack, channel, slot, message, cursor='', seen=()):
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
        if marker in text or (legacy in text and int(oldest) <= posted_at < int(oldest) + SLOT_SECONDS):
            return {'state': 'delivered', 'duplicate': True, 'channel': channel,
                    'ts': item['ts'], 'marker': marker}
    next_cursor = page.get('response_metadata', {}).get('next_cursor', '')
    if next_cursor:
        if next_cursor in seen:
            raise RuntimeError('Slack history pagination did not advance')
        return {'state': 'scanning', 'cursor': next_cursor, 'seen': [*seen, next_cursor]}
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


def generate_report(runtime, state, slot, timing_roots):
    token = subprocess.check_output(['gh', 'auth', 'token'], text=True, timeout=30).strip()
    if not token:
        raise RuntimeError('GitHub token unavailable')
    output = state / 'reports' / slot.replace(':', '-')
    environment = {**os.environ, 'GITHUB_TOKEN': token, 'DELIVERY_GITHUB_TOKEN': token,
                   'FITSY_LOCAL_TIMING_ROOTS': json.dumps(timing_roots)}
    result = subprocess.run(['node', str(runtime / 'hourly-report.mjs'), '--output-dir', str(output),
                             f'--slot={slot}', '--dry-run'], env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    if result.returncode:
        raise RuntimeError(f'report collection failed: {result.stderr.strip()[:300]}')
    report = json.loads((output / 'report.json').read_text())
    if report.get('slotKey') != slot:
        raise RuntimeError('report slot identity mismatch')
    return (output / 'report.txt').read_text().strip()


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
            receipt = post_once(slack, config['channel'], slot, message,
                                prior.get('cursor', ''), prior.get('seen', []))
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
        run_once(config, state, bridge.Slack(bridge.Store(settings)))


if __name__ == '__main__':
    main()
