interface PreviewTourState {
  preview: boolean;
  locked: boolean | null;
  loading: boolean;
  error: string | null;
  outOfArea: boolean;
  fetchSeq: number;
}

export function previewTourReady(state: PreviewTourState): boolean {
  // A completed search can be empty; the restaurant tip explains that state.
  return state.preview && state.locked === true && state.fetchSeq > 0 &&
    !state.loading && !state.error && !state.outOfArea;
}
