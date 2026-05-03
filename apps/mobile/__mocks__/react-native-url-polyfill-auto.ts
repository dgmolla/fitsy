/**
 * Jest mock for `react-native-url-polyfill/auto`.
 *
 * The real module is untranspiled ESM and is only needed to install URL/Blob
 * polyfills inside the React Native runtime. Node test env already has both,
 * so no-op the side-effect import.
 */
export {};
