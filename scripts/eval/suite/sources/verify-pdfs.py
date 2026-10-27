"""Verify the suite's individually transcribed rows against supplied official PDF bytes.

No network, credentials, database, model calls, or fixture mutations.
Fetch the two documented official URLs separately, then pass their directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def verify(directory: Path) -> int:
    checks = json.loads(Path(__file__).with_name('pdf-checks.json').read_text())['rows']
    cached = {}
    for row in checks:
        key = 'claim-jumper' if row['chain'] == 'Claim Jumper' else 'wahoos'
        if key not in cached:
            pdf = directory / (key + '.pdf')
            digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
            text = subprocess.check_output(['pdftotext', '-layout', str(pdf), '-'], text=True)
            cached[key] = (digest, text.split('\f'))
        digest, pages = cached[key]
        if digest != row['source']['sha256']:
            raise ValueError('Source PDF digest differs: ' + key)
        page = pages[row['source']['page'] - 1]
        normalize = lambda text: ' '.join(text.split())
        if normalize(row['sourceText']) not in normalize(page):
            raise ValueError('Inspected source row missing: ' + row['id'])
        # The inspected header establishes column order; parse only that named row's numeric tail.
        # A single space can separate adjacent numeric PDF columns; names may contain numbers.
        tail = re.split(r'\s{2,}', row['sourceText'].strip(), maxsplit=1)[1].split()
        numbers = [float(t.replace(',', '')) for t in tail if re.fullmatch(r'(?:\d+(?:\.\d+)?|\.\d+)', t)]
        columns = [0, 10, 7, 2] if key == 'claim-jumper' else [0, 2, 3, 4]
        observed = [row['observed'][m] for m in ['calories', 'protein', 'carbs', 'fat']]
        if len(numbers) != (15 if key == 'claim-jumper' else 11) or [numbers[i] for i in columns] != observed:
            raise ValueError('Independent numeric source comparison failed: ' + row['id'])
    return len(checks)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf-dir', required=True, type=Path)
    print(f'Verified {verify(parser.parse_args().pdf_dir)} individually inspected PDF rows.')
