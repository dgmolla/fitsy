#!/usr/bin/env python3
"""Keep failed production verification attempts in one open GitHub incident."""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = 'dgmolla/fitsy'
MARKER = '<!-- fitsy-production-release-incident -->'


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True, timeout=45).stdout


def pages(endpoint):
    result = json.loads(gh('api', f'repos/{REPO}/{endpoint}', '--paginate', '--slurp'))
    if not isinstance(result, list) or any(not isinstance(page, list) or
            any(not isinstance(row, dict) for row in page) for page in result):
        raise ValueError('invalid GitHub pagination response')
    return [row for page in result for row in page]


def report():
    source = os.environ.get('RELEASE_SHA', '')
    run = os.environ.get('GITHUB_RUN_ID', '')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    if (os.environ.get('GITHUB_REPOSITORY') != REPO or
            os.environ.get('GITHUB_SERVER_URL') != 'https://github.com' or
            not re.fullmatch(r'[0-9a-f]{40}', source) or
            not all(re.fullmatch(r'[1-9][0-9]*', value) for value in (run, attempt))):
        raise ValueError('invalid release reporting identity')

    base = f'https://github.com/{REPO}'
    run_url = f'{base}/actions/runs/{run}'
    receipt = f'<!-- fitsy-production-release-run:{run}:{attempt}:{source} -->'
    body = f'''**TL;DR:** Production verification stopped; inspect the exact failed deployment before resuming.

Source: [{source}]({base}/commit/{source}).
[Deploy logs]({run_url}/attempts/{attempt}) identify the failed Vercel deployment, build/migration logs and observed fitsy.org serving source.
A healthy older source does not establish recovery.
For Prisma P3009, retain failed history and follow [the read-only migration audit and separately authorized recovery]({base}/blob/{source}/docs/engineering/devops/routine-production.md).
Do not automatically resolve or retry failed migrations.
The manual production-migration-recovery.yml workflow defaults to audit and retains production-release approval for the exact #643 recovery.
If rollback is needed, use the retained verified deployment URL with scripts/deploy/rollback.sh api.
Keep this incident open until exact-source production verification succeeds; subsequent failures are recorded here with their own evidence.

{MARKER}
{receipt}
'''
    # The existing deploy-production concurrency serializes this sole publisher.
    # Read all open incidents directly; search indexing can lag a successful write.
    incidents = [row for row in pages('issues?state=open&labels=incident&per_page=100')
                 if row.get('state') == 'open' and 'pull_request' not in row and
                 (MARKER in (row.get('body') or '') or
                  re.fullmatch(r'incident: prod release failed at [0-9a-f]{7,40}', row.get('title', '')))]
    # Reuse an existing marked incident, otherwise adopt the oldest legacy report
    # without rewriting its original evidence or closing other historical issues.
    incident = min(incidents, key=lambda row: (MARKER not in (row.get('body') or ''), row['number']), default=None)
    if incident:
        number = incident['number']
        reports = [incident, *pages(f'issues/{number}/comments?per_page=100')]
        if any(receipt in (row.get('body') or '') or
               (attempt == '1' and f'{run_url})' in (row.get('body') or '') and source in (row.get('body') or ''))
               for row in reports):
            print(f'Production incident #{number} already records this release attempt')
            return

    with tempfile.TemporaryDirectory(prefix='fitsy-production-incident-') as directory:
        path = Path(directory) / 'body.md'
        path.write_text(body)
        if incident:
            result = gh('issue', 'comment', str(incident['number']), '--repo', REPO, '--body-file', str(path))
        else:
            result = gh('issue', 'create', '--repo', REPO, '--label', 'incident',
                        '--title', f'incident: prod release failed at {source[:7]}', '--body-file', str(path))
        print(result.strip())


if __name__ == '__main__':
    try:
        report()
    except (OSError, ValueError, subprocess.SubprocessError):
        # Never create a replacement after a failed read or repeat an uncertain write.
        print('Production incident reporting failed; inspect the GitHub outcome before retrying.', file=sys.stderr)
        raise SystemExit(1)
