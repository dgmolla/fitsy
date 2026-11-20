export type WaitlistState = 'idle' | 'joining' | 'joined' | 'error';

/** Label for Discovery's "Keep me posted" action as a signed-in user joins in place (#1010). */
export function waitlistLabel(state: WaitlistState): string {
  return state === 'joining' ? 'Adding you…' : state === 'joined' ? "You're on the list" : state === 'error' ? 'Try again' : 'Keep me posted';
}
