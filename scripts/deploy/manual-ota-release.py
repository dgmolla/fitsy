#!/usr/bin/env python3
"""Read-only admission for Dawit's explicit production OTA dispatch."""
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('routine_release', Path(__file__).with_name('routine-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def admit(event):
    source = os.environ.get('GITHUB_SHA', '')
    approval = event.get('inputs', {}).get('approve_production_ota')
    release.require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
                    and os.environ.get('GITHUB_REPOSITORY') == release.REPO
                    and os.environ.get('GITHUB_REF') == 'refs/heads/main'
                    and os.environ.get('GITHUB_ACTOR') == 'dgmolla'
                    and (approval is True or approval == 'true')
                    and re.fullmatch('[a-f0-9]{40}', source),
                    'Dawit must explicitly approve production OTA for the dispatched main revision')
    release.current(source)
    runs = release.github({}, f'repos/{release.REPO}/actions/workflows/verify.yml/runs?head_sha={source}&event=push&per_page=1')
    rows = runs.get('workflow_runs', [])
    release.require(len(rows) == 1, 'missing current main push Verify')
    run = rows[0]
    release.require(run.get('head_sha') == source and run.get('path') == '.github/workflows/verify.yml'
                    and run.get('event') == 'push' and run.get('head_branch') == 'main'
                    and run.get('repository', {}).get('full_name') == release.REPO
                    and run.get('head_repository', {}).get('full_name') == release.REPO
                    and run.get('status') == 'completed' and run.get('conclusion') == 'success',
                    'successful same-repository current main push Verify required')
    return {'release_sha': source, 'verify_run_id': run['id'], 'approved_by': 'dgmolla'}


if __name__ == '__main__':
    try:
        with open(os.environ['GITHUB_EVENT_PATH']) as file:
            print(json.dumps(admit(json.load(file))))
    except Exception as error:
        print(f'Production OTA refused: {error}', file=sys.stderr)
        sys.exit(1)
