export type WaitlistState = 'idle' | 'joining' | 'joined' | 'error';

const LABELS: Record<WaitlistState, string> = {
  idle: 'Keep me posted', joining: 'Adding you…', joined: "You're on the list", error: "Couldn't add you. Tap to try again",
};
/** Discovery's "Keep me posted" action as a signed-in user joins in place (#1010); a failure reads on the button itself. */
export const waitlistLabel = (state: WaitlistState) => LABELS[state];
