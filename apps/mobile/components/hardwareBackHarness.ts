import { BackHandler } from 'react-native';

/** Dispatch the native Android event through the real focused navigators. */
export function installHardwareBackFixture() {
  const listeners = new Set<() => boolean | null | undefined>();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => {
    listeners.add(handler);
    return { remove: () => { listeners.delete(handler); } };
  });
  return () => [...listeners].reverse().some(handler => handler() === true);
}
