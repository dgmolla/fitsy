#!/usr/bin/env python3
"""Fingerprint the actual immutable iOS bundle, assets and runtime configuration."""
import hashlib
import json
import os
import re
import subprocess
import sys
from email.parser import BytesParser
from pathlib import Path


def identity(body, runtime):
    if body.lstrip().startswith(b'{'):
        manifest = json.loads(body)
    else:
        boundary = body.splitlines()[0][2:]
        if not re.fullmatch(rb'[-_A-Za-z0-9]{1,70}', boundary):
            raise ValueError('Invalid Expo manifest boundary')
        message = BytesParser().parsebytes(b'Content-Type: multipart/mixed; boundary="' + boundary + b'"\r\n\r\n' + body)
        parts = [part for part in message.walk() if part.get_param('name', header='content-disposition') == 'manifest']
        if len(parts) != 1:
            raise ValueError('Missing unique Expo manifest')
        manifest = json.loads(parts[0].get_payload(decode=True))
    if manifest['runtimeVersion'] != runtime:
        raise ValueError('Bundle runtime differs from verified binary')
    def asset(value):
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', value['hash']):
            raise ValueError('Missing verified asset content hash')
        return {'hash': value['hash'], 'contentType': value['contentType']}
    # Exclude group IDs, dates and download URLs. They change on republish.
    payload = {'runtime': runtime, 'launch': asset(manifest['launchAsset']),
               'assets': sorted((asset(x) for x in manifest['assets']), key=lambda x: (x['hash'], x['contentType'])),
               'extra': manifest['extra']}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    group = sys.argv[1]
    runtime = json.loads((Path(__file__).resolve().parents[0] / 'ios-binary-baseline.json').read_text())['runtime_version']
    env = {key: value for key, value in os.environ.items() if key not in ('GH_TOKEN', 'GITHUB_TOKEN')}
    updates = json.loads(subprocess.check_output(['npx', 'eas-cli@18', 'update:view', group, '--json'], env=env))
    ios = [x for x in updates if x['platform'] == 'ios' and x['group'] == group]
    if len(ios) != 1 or ios[0]['runtimeVersion'] != runtime or ios[0].get('isRollBackToEmbedded'):
        raise ValueError('Missing verified iOS group/runtime')
    url = ios[0]['manifestPermalink']
    if not re.fullmatch(r'https://u\.expo\.dev/update/[a-f0-9-]{36}', url):
        raise ValueError('Unexpected immutable manifest URL')
    body = subprocess.check_output(['curl', '-fsSL', '--retry', '3', '--retry-delay', '2', '--retry-all-errors', url], env=env)
    value = identity(body, runtime)
    print(value if '--identity-only' in sys.argv else json.dumps({'group': group, 'platform': 'ios', 'runtime': runtime, 'identity': value}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Cannot verify iOS bundle identity: {error}', file=sys.stderr)
        sys.exit(1)
