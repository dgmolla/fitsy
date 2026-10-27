/** Reorder loaded results without mutating them or changing their contents. */
export function shuffleResults<T>(results: readonly T[]): T[] {
  const shuffled = [...results];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Every tap should visibly change the leading card when there is a choice.
  if (shuffled.length > 1 && shuffled[0] === results[0]) {
    const j = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    [shuffled[0], shuffled[j]] = [shuffled[j], shuffled[0]];
  }
  return shuffled;
}
