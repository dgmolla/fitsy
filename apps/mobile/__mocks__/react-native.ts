/**
 * Minimal jest mock for `react-native` — only the surface our `lib/*` node
 * tests touch. The full module can't load in the ts-jest node env (it binds to
 * native + Flow-typed source). Screens/components are tested under the
 * jest-expo project instead, which provides the real RN test shims.
 */
type SelectSpec<T> = { ios?: T; android?: T; native?: T; default?: T };

export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select: <T,>(spec: SelectSpec<T>): T | undefined =>
    spec.ios ?? spec.native ?? spec.default,
};
