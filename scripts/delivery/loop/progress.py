"""Keep the existing local progress report consistent with validated driver tasks."""
import json
import os
from pathlib import Path
import time
from taskfiles import task_files

directory = Path(os.environ.get('FITSY_LOOP_DIR', os.path.expanduser('~/fitsy-refactor/loop')))
state = json.loads((directory / 'state.json').read_text())
out = ['# Fitsy cutback loop progress', '', '**TL;DR:** Current task outcomes from the existing loop owner.', '',
       f'Updated {time.strftime("%Y-%m-%d %H:%M %Z")}. State: loop/state.json; log: loop/driver.log.', '']
for path in task_files(directory / 'tasks'):
    name = Path(path).stem
    task = state.get(name, {})
    status = ('CLOSED (superseded)' if task.get('closed') else 'MERGED' if task.get('done') else
              'BLOCKED: ' + task['blocked'][:200] if task.get('blocked') else 'in progress' if task else 'queued')
    out.append(f'- {name}: {status}' + (f' (PR #{task["pr"]})' if task.get('pr') else ''))
out += ['', 'Planner picks (LLM):'] + [f'- {p["at"]} #{p["issue"]} [{p["lane"]}]: {p["reason"]}'
                                      for p in state.get('_picks', [])[-5:]]
log = directory / 'driver.log'
out += ['', 'Last log lines:', '```'] + (log.read_text().splitlines()[-5:] if log.exists() else []) + ['```']
(directory.parent / 'loop-progress.md').write_text('\n'.join(out) + '\n')
