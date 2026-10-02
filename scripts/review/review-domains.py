#!/usr/bin/env python3
"""Trusted routing for a single independent review round; overrides only add coverage."""
import argparse
import fnmatch
import fcntl
import json
import os
from pathlib import Path
import sys

DANGER = ('apps/api/lib/auth*', 'apps/api/lib/subscription*', 'apps/api/services/auth*', 'apps/api/services/revenuecat*', 'apps/api/app/api/auth/*', 'apps/api/app/api/revenuecat/*', 'apps/api/app/api/subscriptions/*', 'apps/api/app/api/restaurants/route.ts', 'apps/api/app/api/restaurants/*/menu/route.ts', 'apps/api/app/api/user/route.ts', 'apps/mobile/app/auth/*', 'apps/mobile/app/welcome/payment*', 'apps/mobile/app/welcome/resubscribe.tsx', 'apps/mobile/components/*Auth*', 'apps/mobile/components/*Paywall*', 'apps/mobile/components/*Payment*', 'apps/mobile/lib/*Auth*', 'apps/mobile/lib/auth*', 'apps/mobile/lib/*Entitle*', 'apps/mobile/lib/entitle*', 'apps/mobile/lib/*Purchas*', 'apps/mobile/lib/*Paywall*', 'apps/mobile/lib/*paywall*', 'apps/mobile/lib/*purchase*', 'prisma/schema.prisma', 'prisma/migrations/*')
CONTROL_DOCS = ('docs/engineering/devops/shipping.md', 'docs/engineering/devops/review-dispositions.md', 'docs/engineering/devops/agent-model-routing.md', 'docs/engineering/devops/task-management.md', 'docs/engineering/devops/autonomous-shipping.md')
WORKFLOW = ('REVIEW.md', '.claude/lenses/*', '.github/workflows/*', 'scripts/delivery/*', 'scripts/deploy/*', 'scripts/review/*.sh', 'scripts/review/*.py', 'scripts/review/*.mjs', 'scripts/review/*.jq', 'scripts/verify/*.sh', 'scripts/verify/*.mjs', 'scripts/verify/registry.yml', 'scripts/verify/risk-tiers.yml', 'scripts/sim/publish-product-flow.mjs', 'vercel.json', 'apps/mobile/eas.json', 'apps/mobile/app.config.ts') + CONTROL_DOCS
EXCLUDED = ('docs/*', 'proj-mgmt/*', '*.md', '*.mdx', '*.test.*', '*.spec.*', '*.fixture.*', '*/__mocks__/*', 'apps/mobile/e2e/*')


def matches(path, patterns):
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def route(paths, extra=()):
    domains = {'correctness'}
    for path in paths:
        if path == 'REVIEW.md' or matches(path, ('.claude/lenses/*', '.github/workflows/*')) or path in CONTROL_DOCS:
            domains.add('workflow-security')
        if matches(path, EXCLUDED):
            continue
        if matches(path, DANGER):
            domains.add('danger-zone')
        if matches(path, WORKFLOW):
            domains.add('workflow-security')
    for domain in extra:
        if domain not in ('correctness', 'danger-zone', 'workflow-security', 'docs-sanity'):
            raise ValueError('unknown additive review domain: ' + domain)
        domains.add(domain)
    return [domain for domain in ('correctness', 'danger-zone', 'workflow-security', 'docs-sanity') if domain in domains]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--add-domain', action='append', default=[])
    parser.add_argument('--state-file')
    parser.add_argument('--candidate')
    parser.add_argument('--issue')
    args = parser.parse_args()
    try:
        extras = args.add_domain
        route([], extras)  # Validate before changing trusted state.
        if args.state_file:
            if not args.candidate or not args.issue:
                raise ValueError('retained domains require candidate and issue binding')
            state = Path(args.state_file)
            state.parent.mkdir(parents=True, exist_ok=True)
            with open(str(state) + '.lock', 'a') as lock:
                os.chmod(lock.name, 0o600)
                fcntl.flock(lock, fcntl.LOCK_EX)
                if state.exists():
                    saved = json.loads(state.read_text())
                    if saved.get('candidate') != args.candidate or saved.get('issue') != args.issue or not isinstance(saved.get('domains'), list):
                        raise ValueError('retained domain binding conflicts with candidate')
                    extras = saved['domains'] + extras
                extras = route([], extras)
                if args.add_domain:
                    temporary = state.with_suffix('.tmp')
                    with open(temporary, 'w') as output:
                        os.chmod(temporary, 0o600)
                        json.dump({'candidate': args.candidate, 'issue': args.issue, 'domains': extras}, output)
                    os.replace(temporary, state)
        print(' '.join(route(sys.stdin.read().splitlines(), extras)))
    except (ValueError, OSError, TypeError, AttributeError) as error:
        parser.error(str(error))
