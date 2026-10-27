import { isDevelopmentEnvironment, REVIEWER_EMAIL } from '@/services/runtimeEnvironment';
export { REVIEWER_EMAIL } from '@/services/runtimeEnvironment';

export function canUsePasswordLogin(email: string): boolean {
  return isDevelopmentEnvironment() || email.trim().toLowerCase() === REVIEWER_EMAIL;
}

export function canRegisterWithPassword(): boolean {
  return isDevelopmentEnvironment();
}
