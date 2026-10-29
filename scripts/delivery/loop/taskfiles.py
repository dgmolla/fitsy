"""The driver and planner share task validation and human priority notes."""
from pathlib import Path
import re


def read_task(path):
    text = Path(path).read_text()
    lines = text.splitlines()
    start = 1 if lines and lines[0] == '---' else 0
    try:
        end = lines.index('---', start)
    except ValueError:
        return None
    meta = dict(re.findall(r'^(\w+):\s+(.+)$', '\n'.join(lines[start:end]), re.M))
    branch = meta.get('branch', '')
    if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_./-]*', branch) or
            '..' in branch or branch.endswith(('/', '.lock', '.')) or
            not meta.get('title', '').strip()):
        return None
    body = '\n'.join(lines[end + 1:]).strip()
    return (meta, body) if body else None


def task_files(directory, log=lambda *args: None):
    files = []
    for path in sorted(Path(directory).glob('*.md')):
        if read_task(path):
            files.append(str(path))
        else:
            log('SKIP non-task', path.name)
    return ordered_tasks(files, priority_notes(directory))


def migrate_notes(directory):
    """Only recognizable notes move; malformed task candidates stay for diagnosis."""
    directory = Path(directory)
    for path in directory.glob('NOTES*.md'):
        if not read_task(path):
            target = directory / 'notes' / path.name
            target.parent.mkdir(exist_ok=True)
            if not target.exists():
                path.rename(target)


def priority_notes(directory):
    directory = Path(directory)
    paths = sorted((directory / 'notes').glob('*.md'))
    paths += [path for path in sorted(directory.glob('NOTES*.md')) if not read_task(path)]
    return '\n\n'.join(path.read_text() for path in paths)


def issue_number(path, meta=None):
    match = re.search(r'issue-(\d+)', Path(path).stem)
    if not match and meta:
        match = re.search(r'(?:Closes|Fixes)\s+#(\d+)', meta.get('body', ''), re.I)
    return int(match[1]) if match else None


def ordered_tasks(files, notes):
    # Notes are advisory ordering, never a new admission/dependency gate.
    edges = [(int(a), int(b)) for a, b in re.findall(
        r'#(\d+)[^\n#]*?\bbefore\b[^\n#]*?#(\d+)', notes, re.I)]
    for line in notes.splitlines():
        if line.lower().startswith('order:'):
            ids = [int(n) for n in re.findall(r'#(\d+)', line)]
            edges.extend(zip(ids, ids[1:]))
    pending, ordered = list(files), []
    while pending:
        ids = {issue_number(path, read_task(path)[0]) for path in pending}
        first = next((path for path in pending if not any(
            b == issue_number(path, read_task(path)[0]) and a in ids for a, b in edges)), pending[0])
        ordered.append(first)
        pending.remove(first)
    return ordered
