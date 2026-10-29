const listeners = new Set<() => void>();
export function notifyWidgetUpdates(): void { for (const listener of listeners) listener(); }
export function subscribeWidgetUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
