#!/usr/bin/env -S -i /usr/bin/python3 -I
"""One-shot bridge from independently held existing review evidence to GitHub.

Install only after independent review, under a separate OS operator identity.
This is not a reviewer, installer, scheduler, cache, or production deployer.
"""
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import subprocess
import sys
import urllib.request
import uuid

CONFIG = Path('/opt/fitsy-approval/delivery-authority.json' if sys.platform == 'darwin'
              else '/etc/fitsy/delivery-authority.json')
INSTALL = Path('/opt/fitsy-approval/external-approval.py')
REPO = 'dgmolla/fitsy'
CHECK = 'delivery/independent-review'
ACCEPTANCE_CHECK = 'delivery/acceptance'
ACTIONS_APP = 15368
APP_PERMISSIONS = {'metadata': 'read', 'checks': 'write', 'contents': 'read', 'issues': 'read',
                   'pull_requests': 'read', 'actions': 'write', 'administration': 'read'}
APP_KEY_FINGERPRINT = 'SHA256:qD7XvlHIile2flN5AEavSX+P6ZVrlIDddPVus9YLkQg='
REPOSITORY_ID = 1188934600
VERIFY_JOBS = ('classify', 'Static (L0-L1)', 'Tests (L2)', 'Build (L3)',
               'Single-domain PR check')
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
    require(receipt.get('native') == boundary.get('native'), 'native boundary approval changed')
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
            and observed.get('operator_home_read') is False,
            'candidate boundary does not match original claim')
    network_policy = boundary.get('network_policy')
    if network_policy is None:
        require(receipt.get('network_policy') is None and observed.get('network_policy') is None
                and observed.get('network') is False,
                'candidate boundary does not match original claim')
    else:
        # The full independently reviewed profile hash above grants local binding.
        # Domain rules constrain proxy destinations, not bind addresses or ports.
        policies = (network_policy, receipt.get('network_policy'), observed.get('network_policy'))
        require(all(type(policy) is dict and set(policy) == {
                    'mode', 'network_proxy', 'allow_local_binding', 'domains'}
                    and policy.get('mode') == 'native-local-proxy'
                    and policy.get('network_proxy') is True
                    and policy.get('allow_local_binding') is True
                    and type(policy.get('domains')) is dict
                    and policy['domains'] == {'localhost': 'allow', '127.0.0.1': 'allow'}
                    for policy in policies), 'native local network policy is not approved')
        native = boundary.get('native')
        require(type(native) is dict and bool(native) and observed.get('native') == native
                and observed.get('network') is True
                and observed.get('source_sha') == boundary['source_sha']
                and observed.get('comparison_base') == boundary['comparison_base'],
                'native local network does not match original claim')
        checks = receipt.get('live_checks') or {}
        require(all(denials.get(key) is True for key in ('external_http_proxy', 'external_raw_tcp'))
                and all(checks.get(key) is True for key in (
                    'loopback_nonce_http', 'loopback_listener_closed', 'external_host_controls')),
                'native local network live proof incomplete')
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
    return claim


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


def native_candidate_command(boundary, product_root, cwd, command, env):
    """Native requests are data; only the private approved binding grants execution."""
    native = boundary.get('native')
    require(isinstance(native, dict), 'native candidate boundary is not configured')
    require(isinstance(product_root, str) and isinstance(cwd, str), 'native product root/cwd are required')
    require(all(isinstance(native.get(key), str) and re.fullmatch(r'[0-9a-f]{40}', native[key])
                for key in ('source_sha', 'source_tree')), 'native source/tree binding is incomplete')
    product = Path(product_root).resolve(strict=True)
    require(product == Path(native['root']).resolve(strict=True), 'native product root mismatch')
    require(cwd in ('.', 'apps/mobile', 'apps/mobile/ios') and cwd in native['allowed_cwds'],
            'native working directory is not approved')
    working = (product / cwd).resolve(strict=True)
    require(working == product or product in working.parents, 'native working directory escapes product')
    require(isinstance(command, list) and command and all(isinstance(arg, str) for arg in command)
            and command[0] and not command[0].startswith('-'), 'native candidate command is required')
    require(type(native['deadline_seconds']) is int and native['deadline_seconds'] > 0,
            'native command deadline is required')
    environment = {}
    for entry in env:
        key, separator, value = entry.partition('=')
        public_key = bool(re.fullmatch(r'EXPO_PUBLIC_[A-Z0-9_]+', key))
        native_key = key in ('NODE_ENV', 'EXPO_NO_DOTENV', 'FITSY_ALLOW_MISSING_PUBLIC_ENV', 'CI',
                            'FORCE_BUNDLING', 'SKIP_BUNDLING', 'EXPO_OFFLINE',
                            'FITSY_XCTEST_CAPTURE_RECEIPT', 'FITSY_XCTEST_SIM_UDID')
        require(separator and (public_key or native_key) and key not in environment and key in native['environment'],
                'native environment key is not approved or repeated')
        permitted = native['environment'][key]
        if key == 'FITSY_XCTEST_CAPTURE_RECEIPT' and permitted == {'product_flow_capture': True}:
            capture = Path(value)
            require(capture.is_absolute(), 'native capture path must be absolute')
            capture = capture.resolve()
            require(capture.is_relative_to(product) and re.fullmatch(
                r'\.evidence/product-flow/[a-z0-9-]+/xctest-capture-policy\.jsonl',
                capture.relative_to(product).as_posix()), 'native capture path escapes product flow evidence')
        else:
            require(value == permitted if isinstance(permitted, str) else
                    isinstance(permitted, list) and value in permitted, 'native environment value is not approved')
        environment[key] = value
    git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git' if sys.platform == 'darwin' else '/usr/bin/git'
    def snapshot():
        def read(*args):
            return subprocess.check_output([git, '-C', str(product), *args],
                env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty'}, timeout=10).strip()
        require(read('rev-parse', 'HEAD').decode() == native['source_sha']
                and read('rev-parse', 'HEAD^{tree}').decode() == native['source_tree']
                and not read('branch', '--show-current'), 'native product source/tree/detached identity changed')
        paths = set(filter(None, (read('diff', '--name-only', '--no-renames', 'HEAD', '--').decode() + '\n' +
            read('ls-files', '--others', '--exclude-standard').decode()).splitlines()))
        # Preparation restores package bytes inside the candidate transaction.
        # Never follow candidate aliases to parse package JSON as the operator.
        require('apps/mobile/package.json' not in paths, 'native package changed or aliases frozen source')
        # Generated iOS files are measured by nativeIdentity around the build.
        require(all(path.startswith('apps/mobile/ios/') for path in paths), 'native product source is dirty')
    snapshot()
    args = ['--cwd', str(working)]
    for key, value in sorted(environment.items()): args += ['--env', key + '=' + value]
    return [*args, '--', *command], snapshot, native['deadline_seconds'] + 5


def candidate_checks(config, issue, source, base, root, check, product_root=None, cwd=None, command=None, env=()):
    """Run fixed publication checks through the independently pinned live boundary."""
    boundary = config.get('candidate_boundary')
    require(boundary is not None, 'isolated candidate launcher is required')
    claim = candidate_custody(config, config['operator_uid'])
    require(boundary.get('network_policy') is None or check == 'native',
            'local network authority requires a native check')
    require(isinstance(claim.get('worktree'), str) and Path(claim['worktree']).is_absolute(),
            'active candidate claim requires its owned worktree')
    root = Path(root).resolve(strict=True)
    require(root == Path(claim['worktree']).resolve(strict=True)
            and boundary['issue'] == issue and boundary['source_sha'] == source
            and boundary['comparison_base'] == base, 'candidate check source/root/issue mismatch')
    environment = {'PATH': '/usr/bin:/bin', 'HOME': '/var/empty', 'LANG': 'en_US.UTF-8'}
    git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git' if sys.platform == 'darwin' else '/usr/bin/git'
    def snapshot():
        def read(*args):
            return subprocess.check_output([git, '-C', str(root), *args], env=environment, timeout=10).strip()
        require(read('rev-parse', 'HEAD').decode() == source
                and read('rev-parse', 'origin/main').decode() == base
                and not read('status', '--porcelain', '--untracked-files=all'),
                'candidate checks require frozen exact source/base')
        return tuple(path.read_bytes() if path.exists() else None for path in (
            root / '.evidence/verify/focused-tests.json', root / '.evidence/delivery/binding.json'))
    frozen = snapshot()
    require(frozen[1] is not None and json.loads(frozen[1]).get('issue') == issue,
            'candidate check delivery issue differs from active authority')
    commands = {
        'cheap': ['/usr/bin/env', 'node', 'scripts/verify/run.mjs', '--layer=0-2',
                  '--stage=cheap', '--scope=changed', '--runs=local', '--reuse',
                  f'--base={base}', f'--head={source}'],
        'push-gates': ['/bin/bash', '-p', '-c',
            'set -eu; for check in size-check domain-check; do '
            'if /bin/bash -p "scripts/verify/$check.sh"; then code=0; else code=$?; fi; '
            '[ "$code" -eq 0 ] || [ "$code" -eq 2 ] || exit "$code"; done'],
    }
    native_snapshot = None
    timeout = 245
    if check == 'native':
        payload, native_snapshot, timeout = native_candidate_command(boundary, product_root, cwd, command, env)
    else:
        require(check in commands, 'unsupported candidate check')
        require(product_root is None and cwd is None and not command and not env,
                'native arguments require a native check')
        payload = commands[check]
    child = None
    interrupted = None
    def stop(signum, _frame):
        nonlocal interrupted
        interrupted = signum
        raise KeyboardInterrupt
    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        child = subprocess.Popen(['/bin/bash', boundary['launcher_path'], '--candidate-command',
                                  *payload], cwd=root, env=environment, start_new_session=True)
        try:
            code = child.wait(timeout=timeout)
        except KeyboardInterrupt:
            code = 128 + (interrupted or signal.SIGINT)
    finally:
        if child is not None:
            # The pinned launcher forwards termination to its owned runner, whose
            # finally block tears down the separate sandbox payload group.
            try: os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                child.wait(timeout=5)
        for sig, handler in previous.items(): signal.signal(sig, handler)
    candidate_custody(config, config['operator_uid'])
    require(snapshot() == frozen, 'candidate or focused selection changed during isolated checks')
    if native_snapshot is not None: native_snapshot()
    return code


def app_auth(config):
    """Read one pinned generation, preserving the exact validated token bytes."""
    uid = config['operator_uid']
    token_raw = protected_bytes(config['app_token_file'], uid, private=True)
    provenance = protected_bytes(config['app_identity_file'], uid, private=True)
    require(digest(provenance) == config['app_identity_sha256'], 'unverified App token provenance')
    identity = json.loads(provenance)
    app, installation, token = identity['app'], identity['installation'], identity['token']
    require(config['app_id'] == 5285837 and config['installation_id'] == 170592990
            and app['id'] == config['app_id'] and installation['app_id'] == app['id']
            and installation['id'] == config['installation_id']
            and installation['account']['login'] == 'dgmolla'
            and installation['repository_selection'] == 'selected', 'App issuer/installation mismatch')
    require(identity['repository_id'] == REPOSITORY_ID, 'App repository scope mismatch')
    require(installation['permissions'] == APP_PERMISSIONS and token['permissions'] == APP_PERMISSIONS,
            'App effective permissions mismatch')
    require(digest(token_raw) == token['sha256'], 'App token changed')
    expiry = datetime.fromisoformat(token['expires_at'].replace('Z', '+00:00'))
    require(expiry.tzinfo is not None and bool(token_raw.decode().strip()), 'App token expiry/credential invalid')
    return identity, token_raw, expiry


def private_replace(path, raw):
    """Atomic per file at existing locations; caller owns the exclusive lock."""
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.renew-' + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def json_bytes(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def app_key_path(config):
    custody = config.get('app_key_custody') or {}
    require(custody.get('public_fingerprint') == APP_KEY_FINGERPRINT
            and custody.get('record') == 'original-human-key-handoff-2026-10-14'
            and isinstance(custody.get('private_key_file'), str)
            and Path(custody['private_key_file']).is_absolute(),
            'App token renewal requires original operator key custody binding')
    return Path(custody['private_key_file'])


def app_jwt(config):
    """Use only the original human-approved key in protected operator configuration."""
    key = app_key_path(config)
    protected_bytes(key, config['operator_uid'], private=True)

    def openssl(arguments, raw=None):
        result = subprocess.run(['/usr/bin/openssl', *arguments], input=raw, capture_output=True,
                                timeout=20, env={'PATH': '/usr/bin:/bin'})
        require(result.returncode == 0, 'App signing key unavailable or invalid; operator must restore original custody')
        return result.stdout

    public = openssl(['pkey', '-in', str(key), '-pubout', '-outform', 'DER'])
    require('SHA256:' + base64.b64encode(hashlib.sha256(public).digest()).decode() == APP_KEY_FINGERPRINT,
            'App signing key fingerprint mismatch')
    encode = lambda raw: base64.urlsafe_b64encode(raw).decode().rstrip('=')
    now = int(datetime.now(timezone.utc).timestamp())
    unsigned = encode(json_bytes({'alg': 'RS256', 'typ': 'JWT'})) + '.' + encode(json_bytes(
        {'iat': now - 60, 'exp': now + 540, 'iss': str(config['app_id'])}))
    return unsigned + '.' + encode(openssl(['dgst', '-sha256', '-sign', str(key)], unsigned.encode()))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def app_request(jwt, endpoint, payload=None):
    request = urllib.request.Request('https://api.github.com' + endpoint,
        data=json_bytes(payload) if payload is not None else None,
        headers={'Authorization': 'Bearer ' + jwt, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'fitsy-approval-renewal',
                 'Content-Type': 'application/json'})
    try:
        # Do not inherit proxy selectors or forward the JWT across redirects.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=20) as response:
            return json.load(response)
    except (OSError, ValueError):
        raise ValueError('App credential renewal transport failed; operator must reconcile retained renewal evidence') from None


def ensure_app_auth(config):
    uid = config['operator_uid']
    parent = Path(config['app_identity_file']).parent
    receipt_path = parent / 'app-renewal-recovery.json'

    def completed_attempt():
        if receipt_path.exists() or receipt_path.is_symlink():
            receipt = json.loads(protected_bytes(receipt_path, uid, private=True))
            require(receipt.get('phase') in ('complete', 'rolled-back'),
                    'App renewal interrupted; operator must reconcile retained renewal evidence')

    completed_attempt()
    identity, raw, expiry = app_auth(config)
    if (expiry - datetime.now(timezone.utc)).total_seconds() > 60:
        return identity, raw
    app_key_path(config)
    # Reuse the original operator's dispatcher lock, never a candidate selector.
    lock_path = Path(pwd.getpwuid(uid).pw_dir) / '.fitsy-dispatcher/dispatcher.lock'
    protected_bytes(lock_path, uid)
    with lock_path.open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        completed_attempt()
        current = authority()
        require({k: v for k, v in current.items() if k != 'app_identity_sha256'}
                == {k: v for k, v in config.items() if k != 'app_identity_sha256'},
                'App renewal authority changed')
        config.update(current)
        identity, raw, expiry = app_auth(config)
        if (expiry - datetime.now(timezone.utc)).total_seconds() > 60:
            return identity, raw
        require(identity['repository_id'] == REPOSITORY_ID
                and identity['app']['slug'] == 'fitsy-delivery-approval', 'App renewal repository/issuer mismatch')
        paths = [parent / 'app-response.json', parent / 'installation-response.json',
                 Path(config['app_token_file']), Path(config['app_identity_file']), CONFIG]
        require(len(set(paths)) == len(paths) and Path(config['app_token_file']).parent == parent,
                'App renewal credential locations mismatch')
        before = {path: protected_bytes(path, uid, private=(path != CONFIG)) for path in paths}
        record = {'phase': 'issuing', 'observed_at': datetime.now(timezone.utc).isoformat(),
                  'adapter_sha256': config['adapter_sha256'],
                  'before': {str(path): digest(value) for path, value in before.items()}}
        jwt = app_jwt(config)
        private_replace(receipt_path, json_bytes(record))
        staged = {}
        issuance_started = False
        try:
            app = app_request(jwt, '/app')
            installation = app_request(jwt, f'/repos/{REPO}/installation')
            require(app['id'] == config['app_id'] and app['slug'] == identity['app']['slug']
                    and installation['id'] == config['installation_id']
                    and installation['app_id'] == app['id']
                    and installation['account']['login'] == 'dgmolla'
                    and installation['repository_selection'] == 'selected'
                    and installation['permissions'] == APP_PERMISSIONS, 'App renewal issuer/scope mismatch')
            if config.get('candidate_boundary') is not None:
                candidate_custody(config, uid)
            issuance_started = True
            token = app_request(jwt, f'/app/installations/{config["installation_id"]}/access_tokens',
                                {'repository_ids': [REPOSITORY_ID], 'permissions': APP_PERMISSIONS})
            secret = token.pop('token').encode()
            require(token['permissions'] == APP_PERMISSIONS and token['repository_selection'] == 'selected'
                    and len(token['repositories']) == 1
                    and token['repositories'][0]['id'] == REPOSITORY_ID
                    and token['repositories'][0]['full_name'] == REPO, 'App renewed token scope mismatch')
            require(bool(secret.strip()) and (datetime.fromisoformat(token['expires_at'].replace('Z', '+00:00'))
                    - datetime.now(timezone.utc)).total_seconds() > 60, 'App renewed token lifetime invalid')
            token['sha256'] = digest(secret)
            renewed = {'app': app, 'installation': installation, 'token': token,
                       'repository_id': REPOSITORY_ID, 'observed_at': datetime.now(timezone.utc).isoformat()}
            verify_app_scope(config, renewed, secret)
            provenance = json_bytes(renewed)
            updated = {**config, 'app_identity_sha256': digest(provenance)}
            staged = dict(zip(paths, [json_bytes(app), json_bytes(installation), secret,
                                      provenance, json_bytes(updated)]))
            require(all(protected_bytes(path, uid, private=(path != CONFIG)) == value
                        for path, value in before.items()), 'App renewal preimage changed')
            require(authority() == config, 'App renewal authority changed before commit')
            record.update(phase='committing', after={str(path): digest(value) for path, value in staged.items()})
            private_replace(receipt_path, json_bytes(record))
            for path, value in staged.items():
                require(protected_bytes(path, uid, private=(path != CONFIG)) == before[path],
                        'App renewal preimage changed')
                private_replace(path, value)
            config.update(updated)
            record['phase'] = 'complete'
            private_replace(receipt_path, json_bytes(record))
            return renewed, secret
        except BaseException:
            # Restore only this attempt's exact bytes; preserve any intervening write.
            restored = True
            for path, original in before.items():
                observed = protected_bytes(path, uid, private=(path != CONFIG))
                if observed == original:
                    continue
                if staged.get(path) == observed:
                    private_replace(path, original)
                else:
                    restored = False
            record['phase'] = ('rolled-back' if restored and (staged or not issuance_started)
                               else 'recovery-required')
            private_replace(receipt_path, json_bytes(record))
            if restored:
                config.update(json.loads(before[CONFIG]))
            raise


def github_token(config, endpoint, token_raw, payload=None):
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


def github(config, endpoint, payload=None, release=False):
    if release:
        raw = protected_bytes(config['release_token_file'], config['operator_uid'], private=True)
    else:
        _, raw = ensure_app_auth(config)
    return github_token(config, endpoint, raw, payload)


def verify_app_scope(config, identity, raw=None):
    # Staged credentials use the same fixed transport before any protected write.
    call = (lambda endpoint: github_token(config, endpoint, raw)) if raw is not None else (
        lambda endpoint: github(config, endpoint))
    app = identity['app']
    scope = call('installation/repositories?per_page=100')
    require(scope['total_count'] == 1 and len(scope['repositories']) == 1
            and scope['repositories'][0]['full_name'] == REPO
            and scope['repositories'][0]['id'] == identity['repository_id'], 'App repository scope mismatch')
    live_app = call(f'apps/{app["slug"]}')
    actor = call(f'users/{app["slug"]}[bot]')
    require(live_app['id'] == app['id'] and actor['type'] == 'Bot'
            and actor['login'] == config['dispatch_actor_login']
            and type(config['dispatch_actor_user_id']) is int
            and actor['id'] == config['dispatch_actor_user_id']
            and actor['id'] != config['merge_operator_user_id'], 'App dispatch actor mismatch')


def installation_identity(config):
    """Credential provenance and live scope remain separate from review approval."""
    identity, _ = ensure_app_auth(config)
    verify_app_scope(config, identity)


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


def review_validator(name, expected, uid):
    """Execute only verified installed bytes, never a candidate-selected import."""
    require(name in ('review-round', 'review-gate'), 'unknown review validator')
    path = INSTALL.with_name(name + '.py')
    raw = protected_bytes(path, uid)
    require(digest(raw) == expected, 'protected review validator changed')
    namespace = {'__name__': 'fitsy_approval_' + name.replace('-', '_'), '__file__': str(path)}
    exec(compile(raw, str(path), 'exec'), namespace)
    return namespace


def validate_canonical_review(approval, artifacts, policy, issue, source, uid):
    """Apply the existing parser/gate using independently held evidence only."""
    require(type(uid) is int, 'canonical review requires operator custody')
    canonical = policy['canonical_review']
    require(type(canonical) is dict and set(canonical) == {
        'validators', 'diff_sha256', 'evidence_root', 'dispositions'}
        and type(canonical['validators']) is dict
        and set(canonical['validators']) == {'review-round', 'review-gate'},
        'invalid canonical review policy')
    parser = review_validator('review-round', canonical['validators']['review-round'], uid)
    gate = review_validator('review-gate', canonical['validators']['review-gate'], uid)
    verdict = parser['extract'](artifacts['verdict'].decode(), policy['domains'])
    require(verdict is not None, 'incomplete or invalid canonical review')
    require(all(verdict.get(key) == approval[key] for key in (
        'issue', 'source_sha', 'base_sha', 'acceptance_sha256',
        'provider', 'model', 'reasoning_effort')), 'canonical review binding mismatch')
    require(isinstance(canonical['diff_sha256'], str)
            and re.fullmatch(r'[0-9a-f]{64}', canonical['diff_sha256']), 'invalid review diff identity')
    root = Path(canonical['evidence_root'])
    require(root == INSTALL.parent / 'evidence' / f'issue-{issue}' / source,
            'canonical evidence must be operator-held')
    dispositions = canonical['dispositions']
    require(type(dispositions) is dict and set(dispositions) <= set(policy['domains']),
            'unexpected disposition domain')
    for domain in policy['domains']:
        sidecar = dispositions.get(domain)
        path = None
        if sidecar is not None:
            path = Path(sidecar['path'])
            require(path.is_relative_to(root / '.evidence') and '..' not in path.parts,
                    'disposition outside protected evidence')
            raw = protected_bytes(path, uid)
            require(digest(raw) == sidecar['sha256'], 'protected disposition changed')
            data = json.loads(raw)
            require(type(data) is dict and type(data.get('findings')) is list,
                    'invalid protected dispositions')
            # The canonical gate validates test semantics and finding identities.
            # Establish custody first for every file it may read.
            for entry in data.get('findings', []):
                require(type(entry) is dict and type(entry.get('required_tests', [])) is list,
                        'invalid protected disposition tests')
                for test in entry.get('required_tests', []):
                    require(type(test) is dict and isinstance(test.get('receipt'), str),
                            'invalid protected test reference')
                    receipt = root / test['receipt']
                    require(receipt.is_relative_to(root / '.evidence')
                            and '..' not in receipt.parts, 'test outside protected evidence')
                    content = protected_bytes(receipt, uid)
                    require(digest(content) == test['sha256'], 'protected test receipt changed')
        findings = [{key: value for key, value in finding.items() if key != 'domains'}
                    for finding in verdict['findings'] if domain in finding['domains']]
        projected = dict(verdict, lens=domain, verdict=verdict['domains'][domain], findings=findings)
        result = gate['evaluate'](projected, domain, source, canonical['diff_sha256'], path, root)
        require(result['gate'] == 'pass', f'canonical review gate refused {domain}: {result["reason"]}')


def validate_review(approval, artifacts, ledger, policy, issue, source, body, uid=None):
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
    if 'canonical_review' in policy:
        validate_canonical_review(approval, artifacts, policy, issue, source, uid)
    else:
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
    if 'canonical_review' in policy:
        require(approval['source_sha'] == source, 'canonical review source mismatch')
    if boundary is not None:
        require((approval['composition']['comparison_base']
                 if source != approval['source_sha'] and approval.get('composition') else approval['base_sha'])
                == boundary['comparison_base'], 'candidate boundary comparison mismatch')
    artifacts = {name: protected_bytes(row['path'], uid) for name, row in approval['artifacts'].items()}
    ledger = protected_bytes(Path(config['budget_home']) / f'issue-{issue}.jsonl', uid)
    validate_review(approval, artifacts, ledger, policy, issue, approval['source_sha'], body, uid)
    if source != approval['source_sha']:
        require(issue == 443, 'changed controls require fresh independent control review')
        composition = approval.get('composition')
        if composition is None:
            validate_composition(git_tree(config, approval['source_sha']), git_tree(config, source),
                                 git_tree(config, config['control_sha']), config['control_paths'])
        else:
            require(set(composition) == {'source_sha', 'comparison_base', 'comparison_tree_sha', 'control_paths'}
                    and composition['source_sha'] == source and approval['control_sha'] == config['control_sha']
                    and composition['control_paths'] == config['control_paths'], 'composition authority mismatch')
            require(all(isinstance(composition.get(key), str)
                        and re.fullmatch(r'[0-9a-f]{40}', composition[key])
                        for key in ('source_sha', 'comparison_base', 'comparison_tree_sha')),
                    'composition source/main identity invalid')
            original = protected_bytes(approval['original_manifest']['path'], uid, private=True)
            original_approval = json.loads(original)
            require(digest(original) == approval['original_manifest']['sha256']
                    and 'composition' not in original_approval and 'original_manifest' not in original_approval
                    and set(approval) == set(original_approval) | {'composition', 'original_manifest'}
                    and all(approval[key] == value for key, value in original_approval.items()
                            if key not in ('control_sha', 'operator_sha256')),
                    'original frozen review authority changed')
            main = github(config, f'repos/{REPO}/git/commits/{composition["comparison_base"]}')
            require(main['tree']['sha'] == composition['comparison_tree_sha'], 'approved main tree changed')
            validate_composition(git_tree(config, approval['source_sha']), git_tree(config, source),
                git_tree(config, config['control_sha']), config['control_paths'],
                reviewed_base=git_tree(config, approval['base_sha']),
                main=git_tree(config, composition['comparison_base']))
    return approval


def git_tree(config, source):
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'tree source identity invalid')
    endpoint = f'repos/{REPO}/git'
    tree_sha = github(config, f'{endpoint}/commits/{source}')['tree']['sha']
    result = github(config, f'{endpoint}/trees/{tree_sha}?recursive=1')
    require(not result['truncated'], 'complete source tree required')
    return {row['path']: (row['mode'], row['type'], row['sha'])
            for row in result['tree'] if row['type'] != 'tree'}


def validate_local_review(config, issue, source, base, domains):
    """Read-only local admission through the same protected publication authority."""
    policy = config.get('reviews', {}).get(str(issue))
    if policy is None or 'canonical_review' not in policy:
        return None
    require(bool(domains) and len(set(domains)) == len(domains)
            and set(domains) <= set(policy['domains']), 'required local domains mismatch')
    body = github(config, f'repos/{REPO}/issues/{issue}')['body']
    approval = review_inputs(config, issue, source, body)
    require(approval['source_sha'] == source and approval['base_sha'] == base,
            'local canonical source/base mismatch')
    return {'canonical_review': 'pass', 'issue': issue, 'source_sha': source, 'base_sha': base,
            'domains': approval['domains'], 'acceptance_sha256': approval['acceptance_sha256']}


def validate_composition(reviewed, candidate, controls, allowed, *, reviewed_base=None, main=None):
    """Reuse frozen443 only for exact product blobs with approved control blobs."""
    require(bool(allowed) and len(set(allowed)) == len(allowed), 'explicit approved control paths required')
    require(all(any(path == area or (area.endswith('/') and path.startswith(area))
                    for area in CONTROL_AREAS) for path in allowed), 'product path cannot be a control')
    expected_product = reviewed
    if main is not None or reviewed_base is not None:
        require(main is not None and reviewed_base is not None, 'complete approved main context required')
        product_delta = {p for p in set(reviewed_base) | set(reviewed)
                         if p not in allowed and reviewed_base.get(p) != reviewed.get(p)}
        main_delta = {p for p in set(reviewed_base) | set(main)
                      if p not in allowed and reviewed_base.get(p) != main.get(p)}
        require(not product_delta & main_delta, 'frozen product and approved main overlap')
        expected_product = {**main, **{p: reviewed[p] for p in product_delta if p in reviewed}}
        for path in product_delta - reviewed.keys():
            expected_product.pop(path, None)
    for path in set(expected_product) | set(candidate) | set(allowed):
        expected = controls.get(path) if path in allowed else expected_product.get(path)
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
    if receipt.get('id') == 'media-integration':
        require(policy['required_checks'] == {'media-integration': 'pass'},
                'media receipt cannot replace other acceptance checks')
        require(receipt.get('source_sha') == source == policy.get('source_sha')
                and isinstance(policy.get('input_hash'), str)
                and re.fullmatch(r'[0-9a-f]{64}', policy['input_hash'])
                and receipt.get('input_hash') == policy['input_hash'],
                'media acceptance source/input mismatch')
        command = ('FITSY_MEDIA_INTEGRATION=1 npm test --workspace=@fitsy/scripts -- '
                   '--runInBand --runTestsByPath verify/product-flow.test.ts '
                   'sim/xctest-attachments.test.ts sim/runner-controls.test.ts')
        require(receipt.get('command') == command and receipt.get('result') == 'pass'
                and type(receipt.get('exit_code')) is int and receipt['exit_code'] == 0,
                'media acceptance recipe/result mismatch')
        try:
            finished = datetime.fromisoformat(receipt['finished_at'].replace('Z', '+00:00'))
            age = (datetime.now(timezone.utc) - finished).total_seconds()
        except (KeyError, AttributeError, TypeError, ValueError):
            raise ValueError('media acceptance timestamp invalid') from None
        require(0 <= age <= 24 * 3600, 'media acceptance stale or future')
        return
    require(receipt['head_sha'] == source and receipt['source_identity'] == policy['source_identity']
            and receipt['stage'] == 'full' and receipt['finished_at']
            and receipt['arguments'] == policy['arguments'], 'local acceptance source/recipe mismatch')
    results = {row['name']: row for row in receipt['results']}
    require(len(results) == len(receipt['results']) and policy['required_checks'], 'acceptance checks missing')
    require(all(results.get(name, {}).get('status') == status
                for name, status in policy['required_checks'].items()), 'required local acceptance failed')
    require(not any(row.get('blocking') is True and row['status'] not in ('pass', 'skipped')
                    for row in results.values()), 'blocking local acceptance failed')


def ci_acceptance(config, issue, pr, review, verify_id, *, merged_main=None):
    """Bind the existing public Verify to the independently approved candidate tree.

    GitHub's PR run head_sha is the branch head, while default checkout executes
    its synthetic merge. REST PR associations can disappear after merge; only
    release_context may replace an empty association with verified merged-main
    provenance. A same-named green check is not execution evidence.
    """
    endpoint = f'repos/{REPO}'
    source, base = pr['head']['sha'], pr['base']['sha']
    policy = config['local_acceptance'][str(issue)]
    comparison = review['base_sha']
    if review.get('composition') is not None:
        context = review['composition']
        require(issue == 443 and context['source_sha'] == source
                and review['control_sha'] == config['control_sha']
                and context['control_paths'] == config['control_paths'], 'CI composition authority mismatch')
        comparison = context['comparison_base']
    require(base == comparison, 'CI comparison base changed')
    candidate = github(config, f'{endpoint}/git/commits/{source}')
    require(candidate['tree']['sha'] == policy['source_tree_sha'], 'approved verification/source tree changed')
    merge = github(config, f'{endpoint}/git/commits/{pr["merge_commit_sha"]}')
    require([parent['sha'] for parent in merge['parents']] == [base, source]
            and merge['tree']['sha'] == candidate['tree']['sha'], 'CI merge tree/base/head changed')
    workflow = github(config, f'{endpoint}/actions/workflows/{config["verify_workflow_id"]}')
    require(workflow['path'] == '.github/workflows/verify.yml' and workflow['state'] == 'active',
            'trusted Verify workflow changed')
    for ref in (base, source, pr['merge_commit_sha']):
        blob = github(config, f'{endpoint}/contents/.github/workflows/verify.yml?ref={ref}')
        require(blob['type'] == 'file' and blob['path'] == '.github/workflows/verify.yml'
                and blob['encoding'] == 'base64'
                and digest(base64.b64decode(blob['content'])) == config['verify_workflow_sha256'],
                'candidate-controlled Verify definition changed')
    run = github(config, f'{endpoint}/actions/runs/{verify_id}')
    require(run['id'] == verify_id and run['workflow_id'] == config['verify_workflow_id']
            and run['path'] == '.github/workflows/verify.yml' and run['event'] == 'pull_request'
            and run['repository']['full_name'] == REPO and run['head_sha'] == source
            and run['status'] == 'completed' and run['conclusion'] == 'success'
            and type(run['run_attempt']) is int and run['run_attempt'] > 0,
            'exact candidate Verify did not pass')
    if merged_main is not None:
        require(isinstance(merged_main, str) and re.fullmatch(r'[0-9a-f]{40}', merged_main)
                and pr.get('state') == 'closed' and isinstance(pr.get('merged_at'), str)
                and bool(pr['merged_at'])
                and pr['merge_commit_sha'] == merged_main and pr['base']['ref'] == 'main'
                and pr['base']['repo']['full_name'] == REPO
                and pr['head']['repo']['full_name'] == REPO,
                'release merged-main PR provenance mismatch')
    associated = run.get('pull_requests')
    require(type(associated) is list, 'Verify PR association unavailable or malformed')
    if not (merged_main is not None and associated == []):
        require(len(associated) == 1 and isinstance(associated[0], dict)
                and associated[0].get('number') == pr['number']
                and all(isinstance(associated[0].get(side), dict) for side in ('base', 'head'))
                and associated[0]['base'].get('sha') == base
                and associated[0]['head'].get('sha') == source,
                'Verify event PR/base/head mismatch')
    latest = github(config, f'{endpoint}/actions/workflows/{config["verify_workflow_id"]}/runs?head_sha={source}&event=pull_request&per_page=1')
    require(latest['workflow_runs'] and latest['workflow_runs'][0]['id'] == verify_id,
            'superseded Verify cannot authorize acceptance')
    validate_verify_jobs(config, run, source)
    return policy


def validate_verify_jobs(config, run, source, names=VERIFY_JOBS):
    """Shared execution/issuer proof for candidate and automatic main releases."""
    endpoint, verify_id = f'repos/{REPO}', run['id']
    jobs = github(config, f'{endpoint}/actions/runs/{verify_id}/jobs?filter=latest&per_page=100')
    require(0 < jobs['total_count'] <= 100 and jobs['total_count'] == len(jobs['jobs']),
            'complete Verify jobs required')
    for name in names:
        matches = [job for job in jobs['jobs'] if job['name'] == name]
        require(len(matches) == 1, 'required Verify job missing or ambiguous')
        job = matches[0]
        require(job['run_id'] == verify_id and job['run_attempt'] == run['run_attempt']
                and job['head_sha'] == source and job['status'] == 'completed'
                and job['conclusion'] == 'success' and job['labels'] == ['ubuntu-latest']
                and job['check_run_url'] == f'https://api.github.com/{endpoint}/check-runs/{job["id"]}',
                'required Verify job failed, skipped or mismatched')
        check = github(config, f'{endpoint}/check-runs/{job["id"]}')
        require(check['id'] == job['id'] and check['name'] == name and check['head_sha'] == source
                and check['app']['id'] == ACTIONS_APP and check['app']['slug'] == 'github-actions'
                and check['check_suite']['id'] == run['check_suite_id']
                and check['status'] == 'completed' and check['conclusion'] == 'success',
                'Verify job issuer/execution mismatch')


def local_acceptance(config, issue, source, review, policy):
    """Keep applicable local media/native proof without requiring whole local full."""
    before, after = git_tree(config, (review.get('composition') or {}).get('comparison_base', review['base_sha'])), git_tree(config, source)
    changed = [path for path in set(before) | set(after) if before.get(path) != after.get(path)]
    media = any(re.match(r'^scripts/sim/|^scripts/verify/(?:product-flow|media-integration|test\.sh|registry\.yml)',
                         path) for path in changed)
    required = policy['required_checks']
    require(not media or required.get('media-integration') == 'pass', 'applicable real-media acceptance missing')
    if required:
        raw = protected_bytes(policy['receipt_path'], config['operator_uid'])
        require(digest(raw) == policy['receipt_sha256'], 'unverified local acceptance receipt')
        validate_acceptance(json.loads(raw), policy, source)


def publish_acceptance(config, issue, pr_number, verify_id):
    installation_identity(config)
    endpoint = f'repos/{REPO}'
    pr = github(config, f'{endpoint}/pulls/{pr_number}')
    source = pr['head']['sha']
    validate_pr(pr, issue, source)
    body = github(config, f'{endpoint}/issues/{issue}')['body']
    review = review_inputs(config, issue, source, body)
    policy = ci_acceptance(config, issue, pr, review, verify_id)
    local_acceptance(config, issue, source, review, policy)
    current = github(config, f'{endpoint}/pulls/{pr_number}')
    validate_pr(current, issue, source)
    require(current['base']['sha'] == pr['base']['sha']
            and current['merge_commit_sha'] == pr['merge_commit_sha'], 'PR merge evidence changed during acceptance')
    require(acceptance(github(config, f'{endpoint}/issues/{issue}')['body']) == review['acceptance_sha256'],
            'acceptance changed during publication')
    check = github(config, f'{endpoint}/check-runs', {
        'name': ACCEPTANCE_CHECK, 'head_sha': source, 'status': 'completed', 'conclusion': 'success',
        'output': {'title': 'Required acceptance validated',
                   'summary': f'Approved tree {policy["source_tree_sha"]}; trusted Verify run {verify_id}; applicable local evidence validated.'}})
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
            and ruleset.get('bypass_actors') == [{'actor_id': config['merge_operator_user_id'],
                                             'actor_type': 'User', 'bypass_mode': 'pull_request'}]
            and valid_update,
            'exclusive independent merge custody unavailable')


def merge_custody(config):
    # GitHub hides bypass actors from read-only App credentials.
    actor = github(config, 'user', release=True)
    require(actor.get('type') == 'User' and type(actor.get('id')) is int
            and actor['id'] == config['merge_operator_user_id'],
            'merge custody credential must identify the pinned human operator')
    ruleset = github(config, f'repos/{REPO}/rulesets/{config["merge_custody_ruleset_id"]}',
                     release=True)
    validate_merge_custody(ruleset, config)
    return ruleset


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
    merge_custody(config)
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
    candidate_runs = github(config, f'{endpoint}/actions/workflows/{config["verify_workflow_id"]}/runs?head_sha={source}&event=pull_request&per_page=1')
    require(candidate_runs['workflow_runs'], 'required candidate Verify missing')
    policy = ci_acceptance(config, issue, pr, approval, candidate_runs['workflow_runs'][0]['id'],
                           merged_main=main)
    local_acceptance(config, issue, source, approval, policy)
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
    local = commands.add_parser('validate-review')
    local.add_argument('--issue', type=int, required=True)
    local.add_argument('--source', required=True)
    local.add_argument('--base', required=True)
    local.add_argument('--domain', action='append', default=[])
    checks = commands.add_parser('candidate-checks')
    checks.add_argument('--issue', type=int, required=True)
    checks.add_argument('--source', required=True)
    checks.add_argument('--base', required=True)
    checks.add_argument('--root', required=True)
    checks.add_argument('--check', choices=['cheap', 'push-gates', 'native'], required=True)
    checks.add_argument('--product-root')
    checks.add_argument('--cwd')
    checks.add_argument('--env', action='append', default=[])
    checks.add_argument('command', nargs=argparse.REMAINDER)
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
        if args.action == 'candidate-checks':
            command = args.command[1:] if args.command[:1] == ['--'] else args.command
            return candidate_checks(config, args.issue, args.source, args.base, args.root, args.check,
                                    args.product_root, args.cwd, command, args.env)
        if args.action == 'validate-review':
            result = validate_local_review(config, args.issue, args.source, args.base, args.domain)
            if result is None:
                print(json.dumps({'canonical_review': 'not_configured'}))
                return 2
        elif args.action == 'publish-review':
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
