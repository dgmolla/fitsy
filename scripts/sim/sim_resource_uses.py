"""Durable device use/release clocks, called while the shared simulator lock is held."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time


def save(path, value):
    with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix=path.name + '.', delete=False) as out:
        json.dump(value, out); out.flush(); os.fsync(out.fileno()); temporary = Path(out.name)
    temporary.chmod(0o600); os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def event(claim_path, owner, action, udid=None):
    claim_path = Path(claim_path)
    uses_path = claim_path.with_name('.fitsy-sim-uses.json')
    claim = json.loads(claim_path.read_text()) if claim_path.exists() else {}
    uses = json.loads(uses_path.read_text()) if uses_path.exists() else {'version': 1, 'devices': {}}
    if uses.get('version') != 1 or not isinstance(uses.get('devices'), dict):
        raise ValueError('device use registry is invalid')
    owned = owner != 'anonymous' and claim.get('owner') == owner and claim.get('expires', 0) > time.time()
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    if action == 'release':
        if owned:
            for device in claim.get('device_uses', []):
                record = uses['devices'].get(device, {})
                if record.get('owner') == owner:
                    record['released_at'] = now
            save(uses_path, uses)
        return
    if action not in ('intent', 'use') or not re.fullmatch(r'[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}', udid or ''):
        raise ValueError('device use event identity invalid')
    record = uses['devices'].setdefault(udid, {})
    record.update({'owner': owner, 'released_at': now if action == 'use' and not owned and owner != 'anonymous' else None,
                   'pending_use': action == 'intent'})
    if action == 'use':
        record['last_owner_use'] = now
    save(uses_path, uses)  # Uncertain interrupted use protects the device without inventing a use timestamp.
    if owned and claim.get('expires', 0) > time.time():
        claim['device_uses'] = sorted(set(claim.get('device_uses', []) + [udid]))
        save(claim_path, claim)


def owner_release(path, udid):
    path = Path(path)
    uses = json.loads(path.read_text()) if path.exists() else {'version': 1, 'devices': {}}
    if uses.get('version') != 1 or not isinstance(uses.get('devices'), dict):
        raise ValueError('device use registry is invalid')
    record = uses['devices'].get(udid, {})
    if record.get('pending_use') or record.get('owner') in (None, 'anonymous'):
        return {}
    return record


if __name__ == '__main__':
    event(sys.argv[2], sys.argv[3], sys.argv[1], sys.argv[4] if len(sys.argv) > 4 else None)
