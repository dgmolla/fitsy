import { previewTourReady } from './previewTourReady';

const coveredEmpty = {
  preview: true, locked: true, loading: false, error: null,
  outOfArea: false, fetchSeq: 1,
};

it('offers the five preview tips after a covered search returns no dishes', () => {
  expect(previewTourReady(coveredEmpty)).toBe(true);
});

it('waits for a completed covered preview and excludes failed or paid search states', () => {
  for (const change of [
    { fetchSeq: 0 }, { loading: true }, { error: 'Network problem' },
    { outOfArea: true }, { locked: false }, { preview: false },
  ]) {
    expect(previewTourReady({ ...coveredEmpty, ...change })).toBe(false);
  }
});
