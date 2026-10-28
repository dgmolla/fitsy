export const paidServices = ['jev', 'google', 'pdf_finder'] as const;
export type PaidService = typeof paidServices[number];
export interface BudgetState {
  service: PaidService; day: string; capUsd: number; capCalls: string; costUsd: number;
  reservedUsd: number; calls: string; throttles: string; observedAt: string;
}
export interface PaidBudget {
  reserve(service: PaidService, usd: number, scope: string): Promise<string>;
  settle(id: string, usd: number | null, throttled?: boolean): Promise<void>;
}
