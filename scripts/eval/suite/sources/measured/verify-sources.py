"""Independently check admitted snapshot rows against hash-pinned official PDF/HTML bytes.

Offline only. Supply wahoos.pdf, claim-jumper.pdf and old-spaghetti-factory.html.
--initialize writes the source-check artifacts once; normal execution only compares.
"""
import argparse
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
DEMO = HERE.parents[2] / 'pdf-finder' / 'demo'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def clean(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value)).split())


def html_rows(raw):
    """Read labelled official cards independently of the repository parse5 extractor."""
    rows = {}
    sections = re.split(r'<button class="m-content_table__section__title[^\"]*">', raw)
    for section in sections[1:]:
        heading = clean(section.split('</button>', 1)[0])
        cards = re.findall(r'<li class="m-content_table__section__item">(.*?)</li>', section, re.S)
        for card in cards:
            title = re.search(r'<button[^>]*>(.*?)</button>', card, re.S)
            if not title:
                raise ValueError('Missing official card title')
            labels = re.findall(r'<span class="[^"]*__label">(.*?)</span>\s*<span class="[^"]*__value">(.*?)</span>', card, re.S)
            values = {clean(k): clean(v) for k, v in labels}
            key = (heading, clean(title.group(1)))
            if key in rows:
                raise ValueError('Duplicate official card')
            rows[key] = values
    if not rows:
        raise ValueError('No official HTML cards')
    return rows


def verify(source_dir, initialize=False):
    measurement = load(HERE / 'measurement.json.gz')
    plan = load(HERE / 'plan.json')
    audits, pages = [], []
    for chain, config in plan['chains'].items():
        snapshot = measurement[chain]
        keys = set(config['fallbackKeys'])
        for index, item in enumerate(snapshot['ueInventory']):
            if index in config['excluded']:
                continue
            if index in config['positive'] or index in config['negative'] or item.get('missCategory') in config['negativeCategories']:
                keys.update(item.get('relatedPdfKeys', item['lowerTrimPdfKeys']))
                override = config['overrides'].get(str(index), {})
                if override.get('expectedKey'):
                    keys.add(override['expectedKey'])
        review = load(DEMO / chain / 'review.json.gz')['changes']
        manifest = load(DEMO / chain / 'manifest.json')
        raw = (source_dir / (chain + ('.html' if chain == 'old-spaghetti-factory' else '.pdf'))).read_bytes()
        if digest(raw) != manifest['source']['sha256']:
            raise ValueError('Official source hash differs: ' + chain)
        if chain == 'old-spaghetti-factory':
            cards = html_rows(raw.decode())
        else:
            source_pages = subprocess.check_output(['pdftotext', '-layout', str(source_dir / (chain + '.pdf')), '-'], text=True).split('\f')
        for key in sorted(keys):
            row = next(r for r in review if r['canonicalKey'] == key)
            p = row['provenance']
            if chain == 'old-spaghetti-factory':
                values = cards[(p['section'], p['name'])]
                serving = values['Serving Size']
                tokens = [values['Calories'], values['Protein'], values['Carbohydrates'], values['Total Fat / Saturated Fat'].split('/')[0]]
                if any(not re.fullmatch(r'\d+(?:\.\d+)?g?', t) for t in tokens):
                    raise ValueError('Malformed official numeric label: ' + key)
                observed = [float(t.removesuffix('g')) for t in tokens]
                evidence = {'section': p['section'], 'name': p['name'], 'labels': values}
            else:
                page = source_pages[p['page'] - 1]
                if clean(p['rawText']) not in clean(page):
                    raise ValueError('Source row missing from physical PDF page: ' + key)
                tail = re.split(r'\s{2,}', p['rawText'].strip(), maxsplit=1)[1]
                numbers = [float(t.replace(',', '')) for t in tail.split()]
                columns = [0, 10, 7, 2] if chain == 'claim-jumper' else [0, 2, 3, 4]
                if len(numbers) != (15 if chain == 'claim-jumper' else 11):
                    raise ValueError('Unexpected numeric column count: ' + key)
                observed = [numbers[n] for n in columns]
                serving = row['facts']['servingSize'] or f"1 published {p['section'].lower()} serving: {p['name']}"
                evidence = {'page': p['page'], 'sourceText': p['rawText'], 'columns': columns}
                page_record = {'chain': config['name'], 'page': p['page'], 'text': page, 'sha256': digest(page.encode())}
                if not any(v['chain'] == page_record['chain'] and v['page'] == page_record['page'] for v in pages):
                    pages.append(page_record)
            extracted = [row['facts'][k] for k in ['calories', 'proteinG', 'carbsG', 'fatG']]
            if observed != extracted:
                raise ValueError('Official numerical labels disagree with snapshot: ' + key)
            audits.append({'chain': chain, 'key': key, 'serving': serving,
                           'observed': dict(zip(['calories', 'protein', 'carbs', 'fat'], observed)),
                           'sourceSha256': digest(raw), 'evidence': evidence})
        if chain == 'old-spaghetti-factory':
            archived_html = gzip.compress(raw, compresslevel=9, mtime=0)
    outputs = {'row-checks.jsonl': ''.join(json.dumps(a, ensure_ascii=False, separators=(',', ':')) + '\n' for a in audits).encode(),
               'pdf-pages.json.gz': gzip.compress(json.dumps(pages, ensure_ascii=False, separators=(',', ':')).encode(), compresslevel=9, mtime=0),
               'official-osf.html.gz': archived_html}
    for name, data in outputs.items():
        target = HERE / name
        if initialize:
            with target.open('xb') as stream:
                stream.write(data)
        elif target.read_bytes() != data:
            raise ValueError('Source-check artifact differs: ' + name)
    return len(audits), len(pages)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--initialize', action='store_true')
    args = parser.parse_args()
    count, page_count = verify(args.source_dir, args.initialize)
    print(f'Checked {count} selected rows against {page_count} PDF pages and labelled official HTML cards.')
