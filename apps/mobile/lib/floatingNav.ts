import { createContext, useContext } from 'react';

export const FLOATING_TAB_BAR_HEIGHT = 64;
export const FLOATING_TAB_BAR_GAP = 8;

export function floatingTabBarClearance(bottomInset: number): number {
  return FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_GAP + bottomInset;
}

// Outside the floating navigator (including onboarding), no overlay is reserved.
export const FloatingNavClearanceContext = createContext(0);
export function useFloatingNavClearance(): number {
  return useContext(FloatingNavClearanceContext);
}
