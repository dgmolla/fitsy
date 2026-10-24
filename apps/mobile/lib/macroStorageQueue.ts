let targetMutationQueue: Promise<void> = Promise.resolve();

export function mutateTargets<T>(work: () => Promise<T>): Promise<T> {
  const next = targetMutationQueue.then(work, work);
  targetMutationQueue = next.then(() => {}, () => {});
  return next;
}
