import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function classifySimulatorFailure(error) {
  // Assertions, unknown failures, watchdogs and lost ownership stay failures.
  // Only positive infrastructure evidence permits a replay.
  if (/source changed|configuration changed/i.test(error?.message || '')) return 'code';
  if (error?.cleanupError || /interrupt|ownership/i.test([error?.message, error?.reason].join(' '))) return 'environment';
  const diagnostic = [error?.code, error?.message, error?.diagnostic, error?.reason].filter(Boolean).join('\n');
  return /\b(?:ENOSPC|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|kAXErrorInvalidUIElement)\b|CoreSimulator[^\n]*(?:unavailable|connection (?:lost|invalid))|(?:simulator|device)[^\n]*(?:not booted|not available)|XCTest[^\n]*(?:hierarchy unavailable|connection lost)|Local fixture .+ is required|Dev Supabase configuration is required|Metro[^\n]*(?:not ready|unavailable|not running)/i.test(diagnostic)
    ? 'environment' : 'code';
}

export function maestroFailure(message, result, failedCommand) {
  return Object.assign(new Error(message), { diagnostic: failedCommand?.error || result.error,
    reason: result.reason, cleanupError: result.cleanupError });
}

export async function withEnvironmentRetry(action, { dir, signal, canRetry = () => true }) {
  mkdirSync(dir, { recursive: true });
  const attempts = [];
  const save = () => writeFileSync(join(dir, 'attempts.json'), JSON.stringify(attempts, null, 2) + '\n');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const evidence = attempt === 1 ? dir : join(dir, 'attempt-2');
    mkdirSync(evidence, { recursive: true });
    try {
      const value = await action(evidence, attempt);
      attempts.push({ attempt, status: 'pass', evidence }); save();
      return value;
    } catch (error) {
      const classification = classifySimulatorFailure(error);
      const row = { attempt, status: 'fail', classification, evidence, summary: error.message, retry: false };
      attempts.push(row); save();
      error.environmentRetries = attempts.filter(row => row.retry).length;
      if (attempt === 2 || classification !== 'environment' || error.cleanupError || /interrupt|ownership/i.test([error.message, error.reason].join(' ')) || signal?.aborted || !await canRetry()) throw error;
      row.retry = true; save();
      console.error(`Simulator environment failure; retrying once. First attempt retained in ${evidence}`);
    }
  }
}
