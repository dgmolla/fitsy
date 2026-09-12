"""Generate offline state boundaries from the pinned public Census KML archive.

Usage: python3 scripts/gen/chain-us-states.py /path/to/cb_2025_us_state_500k.zip
No simplification, rounding, network requests, or third-party Python dependencies.
"""
import hashlib
import gzip
import io
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

SHA = '4295a503ff47e6787adfb520ad6706557e41c2ce57ced5a134087f8e35143a02'
URL = 'https://www2.census.gov/geo/tiger/GENZ2025/kml/cb_2025_us_state_500k.zip'
archive = Path(sys.argv[1])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == SHA, 'Unexpected Census archive'
with zipfile.ZipFile(archive) as source:
    root = ET.fromstring(source.read('cb_2025_us_state_500k.kml'))
ns = {'k': 'http://www.opengis.net/kml/2.2'}
states = []
points_count = 0
for state in root.findall('.//k:Placemark', ns):
    code = state.find('.//k:SimpleData[@name="STUSPS"]', ns).text
    polygons = []
    for polygon in state.findall('.//k:Polygon', ns):
        rings = []
        for boundary in ['outerBoundaryIs', 'innerBoundaryIs']:
            for coordinates in polygon.findall(f'k:{boundary}/k:LinearRing/k:coordinates', ns):
                points = [[float(v) for v in point.split(',')[:2]] for point in coordinates.text.split()]
                assert len(points) >= 4 and points[0] == points[-1]
                assert all(-180 <= x <= 180 and -90 <= y <= 90 for x, y in points)
                # Unwrap antimeridian rings without changing the underlying coordinates.
                for i in range(1, len(points)):
                    while points[i][0] - points[i - 1][0] > 180:
                        points[i][0] -= 360
                    while points[i][0] - points[i - 1][0] < -180:
                        points[i][0] += 360
                assert points[0] == points[-1], 'Non-local ring crosses the whole globe'
                rings.append(points)
                points_count += len(points)
        outer = rings[0]
        bounds = [min(p[0] for p in outer), min(p[1] for p in outer), max(p[0] for p in outer), max(p[1] for p in outer)]
        polygons.append({'bounds': bounds, 'rings': rings})
    states.append({'code': code, 'polygons': polygons})
assert len(states) == len({s['code'] for s in states}) == 56
assert sum(len(s['polygons']) for s in states) == 1497 and points_count == 285737
out = Path(__file__).resolve().parents[2] / 'apps/api/services/chainUsStates.generated.json.gz'
payload = (json.dumps({'generated': 'Do not edit; run scripts/gen/chain-us-states.py',
    'sourceUrl': URL, 'sourceSha256': SHA, 'states': sorted(states, key=lambda s: s['code'])}, separators=(',', ':')) + '\n').encode()
buffer = io.BytesIO()
with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0) as compressed:
    compressed.write(payload)
out.write_bytes(buffer.getvalue())
# Remove the obsolete uncompressed generated representation when regenerating.
out.with_suffix('').unlink(missing_ok=True)
print(json.dumps({'states': len(states), 'polygons': 1497, 'points': points_count,
    'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))
