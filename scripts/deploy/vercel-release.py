#!/usr/bin/env python3
"""Stage and promote one reviewed source; never infer success from a timeout."""
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT = 'prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4'
TEAM = 'team_VVc52BrZfx5IT2B1mDI5AuPT'
DOMAIN = 'fitsy.org'


def require(value, message):
    if not value:
        raise ValueError(message)


def api(path):
    token = os.environ.get('VERCEL_TOKEN')
    require(token, 'protected project-scoped VERCEL_TOKEN required')
    request = urllib.request.Request(f'https://api.vercel.com{path}?teamId={TEAM}',
                                     headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def alias():
    value = api(f'/v4/aliases/{DOMAIN}')
    require(value['alias'] == DOMAIN and value['projectId'] == PROJECT,
            'serving alias belongs to another project')
    return value['deployment']['id']


def deployment(identifier, source=None):
    require(re.fullmatch(r'dpl_[A-Za-z0-9]+|[a-z0-9-]+\.vercel\.app', identifier), 'invalid immutable deployment')
    value = api(f'/v13/deployments/{identifier}')
    require(value['projectId'] == PROJECT and value['ownerId'] == TEAM and value['target'] == 'production'
            and value['readyState'] == 'READY' and re.fullmatch(r'dpl_[A-Za-z0-9]+', value['id'])
            and re.fullmatch(r'[a-z0-9-]+\.vercel\.app', value['url']),
            'deployment project/target/READY identity mismatch')
    if source:
        require(value['meta']['githubCommitSha'] == source
                and (value.get('gitSource') or {}).get('sha', source) == source, 'deployment source mismatch')
    return value


def cli(*args):
    token = os.environ.get('VERCEL_TOKEN')
    require(token, 'protected project-scoped VERCEL_TOKEN required')
    # Explicit token and isolated config prevent broad developer-login fallback.
    # No release/GitHub/database credentials reach installs, remote build env or smoke.
    home = Path(os.environ['RUNNER_TEMP']) / 'vercel-release-home'
    home.mkdir(exist_ok=True, mode=0o700)
    env = {key: os.environ[key] for key in ('PATH', 'RUNNER_TEMP') if key in os.environ}
    env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / '.config'), CI='1', VERCEL_TOKEN=token,
               VERCEL_ORG_ID=TEAM, VERCEL_PROJECT_ID=PROJECT)
    command = [os.environ['VERCEL_CLI'], *args, '--scope', TEAM]
    result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=900)
    # Never print the command or a token-bearing exception.
    require(result.returncode == 0, 'Vercel command failed; inspect provider state before retrying any mutation')
    return result.stdout


def current(source):
    env = {key: value for key, value in os.environ.items() if key != 'VERCEL_TOKEN'}
    subprocess.run([sys.executable, 'scripts/deploy/routine-release.py', 'current', source], check=True, env=env)


def write(path, value):
    Path(path).write_text(json.dumps(value, sort_keys=True) + '\n')


def stage(source, receipt):
    require(re.fullmatch('[0-9a-f]{40}', source), 'invalid release source')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == source
            and not subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip(),
            'only a clean exact-source checkout may be uploaded')
    current(source)
    previous = deployment(alias())
    write(receipt, {'source': source, 'previous_id': previous['id'], 'previous_url': previous['url'],
                    'phase': 'before-stage'})
    output = cli('deploy', '--prod', '--skip-domain', '--yes', '--meta', f'githubCommitSha={source}',
                 '--env', f'VERCEL_GIT_COMMIT_SHA={source}', '--build-env', f'VERCEL_GIT_COMMIT_SHA={source}')
    urls = re.findall(r'^https://([a-z0-9-]+\.vercel\.app)\s*$', output, re.M)
    require(len(urls) == 1, 'missing unique immutable deployment URL; read back before retry')
    target = deployment(urls[0], source)
    require(target['url'] == urls[0], 'returned deployment URL changed during readback')
    require(alias() == previous['id'], 'staging changed the serving alias; stop and reconcile')
    write(receipt, {'source': source, 'previous_id': previous['id'], 'previous_url': previous['url'],
                    'deployment_id': target['id'], 'deployment_url': target['url'], 'phase': 'staged'})


def promote(receipt):
    data = json.loads(Path(receipt).read_text())
    require(data['phase'] == 'staged', 'only a verified staged target may be promoted')
    current(data['source'])
    target = deployment(data['deployment_id'], data['source'])
    require(target['url'] == data['deployment_url'] and alias() == data['previous_id'],
            'serving target changed since staging; reconcile before promotion')
    data['phase'] = 'promotion-started'
    write(receipt, data)
    try:
        cli('promote', target['url'], '--yes')
    except (ValueError, subprocess.TimeoutExpired):
        # A transport failure can follow a successful provider mutation.
        # Read back exactly once, never repeat the mutation blindly.
        require(alias() == target['id'], 'uncertain promotion; read serving alias before retry, retain receipt')
    require(alias() == target['id'], 'promotion did not serve the exact staged deployment')
    data['phase'] = 'promoted'
    write(receipt, data)
    print(f'Promoted {target["id"]}; rollback: bash scripts/deploy/rollback.sh api https://{data["previous_url"]}')


def verify(receipt):
    data = json.loads(Path(receipt).read_text())
    require(data['phase'] == 'promoted', 'promotion proof required before smoke')
    require(alias() == data['deployment_id'], 'serving deployment changed before/after smoke')
    target = deployment(data['deployment_id'], data['source'])
    require(target['url'] == data['deployment_url'], 'immutable target URL changed')
    # No provider bearer credential is sent to the application.
    with urllib.request.urlopen(f'https://{DOMAIN}/api/health', timeout=30) as response:
        health = json.load(response)
    require(health['status'] == 'ok' and health['db'] == 'connected'
            and health['deploymentSha'] == data['source'], 'production health/source mismatch')
    require(alias() == data['deployment_id'], 'serving deployment changed during health probe')
    print(json.dumps({'deployment_id': data['deployment_id'], 'deploymentSha': data['source'], 'healthy': True}))


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'stage':
            stage(sys.argv[2], sys.argv[3])
        elif action == 'promote':
            promote(sys.argv[2])
        elif action == 'verify':
            verify(sys.argv[2])
        else:
            raise ValueError('unknown release action')
    except Exception as error:
        # Provider/CLI exception text may include transport details. Keep the
        # durable phase receipt and a safe error class, never a bearer or argv.
        print(f'Vercel release stopped ({type(error).__name__}); inspect phase receipt and provider readback before retry.', file=sys.stderr)
        sys.exit(1)
