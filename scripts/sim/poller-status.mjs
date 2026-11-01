// Loaded by the existing Mac poller from a reviewed immutable installation.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const context = 'Simulator';
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const line = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const scrub = (value, env) => Object.values(env).filter(value => typeof value === 'string' && value.length > 3)
  .sort((a, b) => b.length - a.length).reduce((text, secret) => text.split(secret).join('[redacted]'), String(value ?? ''));

export function statusDescription(state, reason) {
  const description = line(reason);
  insist(description || state === 'error', 'Simulator status requires a nonempty description');
  return (description || 'Runner error without a description; inspect the retained Mac attempt log').slice(0, 140);
}

export function attemptOutcome({ head, tries, scope, error, verdict, env = {} }) {
  insist(/^[a-f0-9]{40}$/.test(head) && Number.isSafeInteger(tries) && tries >= 0, 'Invalid Simulator attempt identity');
  const failed = !!error?.gateFail || verdict?.verdict === 'fail';
  const status = failed ? 'failure' : error || verdict?.verdict !== 'pass' ? 'error' : 'success';
  const failures = tries + (status === 'success' ? 0 : 1);
  const retry = status !== 'success' && failures < 2;
  const supplied = error ? error.message || error.stderr : verdict?.blocking;
  const reason = status === 'success' ? `Local ${scope} run + exploration passed`
    : line(scrub(supplied, env)) || (failed ? 'Simulator assertion failed without a reason; inspect retained Maestro commands'
      : 'Runner error without a description; inspect the retained Mac attempt log');
  const timeout = error?.code === 'ETIMEDOUT' ? 'Runner timed out: ' : '';
  const description = statusDescription(status, `${retry ? 'Retry 1/1 queued: ' : ''}${timeout}${reason}`);
  return { head, attempt: tries + 1, tries: failures, retry, status, reason: timeout + reason, description };
}

export function postSimulatorStatus(api, head, state, reason, log = console.log) {
  insist(/^[a-f0-9]{40}$/.test(head) && ['pending', 'success', 'failure', 'error'].includes(state), 'Invalid Simulator status');
  const description = statusDescription(state, reason);
  const result = api(`statuses/${head}`, 'POST', { state, context, description });
  insist(Number.isSafeInteger(result?.id) && result.id > 0 && result.state === state && result.context === context &&
    result.description === description, 'GitHub did not acknowledge the requested Simulator status');
  log(JSON.stringify({ type: 'simulator-status-posted', head, id: result.id, state, description }));
  return result;
}

export function finishSimulatorAttempt({ state, head, scope, error, verdict, env, evidence, post, save }) {
  // Persist the result before publication. A transport/comment failure must not
  // lose the reason, consume another native attempt or reset the retry budget.
  if (!state.pendingStatus) {
    const outcome = attemptOutcome({ head, tries: state.tries, scope, error, verdict, env });
    appendFileSync(join(evidence, 'attempts.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...outcome }) + '\n', { mode: 0o600 });
    state.tries = outcome.tries;
    state.pendingStatus = outcome;
    save();
  }
  const outcome = state.pendingStatus;
  insist(outcome.head === head, 'Pending Simulator status belongs to another head');
  post(head, outcome.status, outcome.description);
  if (!outcome.retry) state.final = outcome.status;
  delete state.pendingStatus;
  save();
  return outcome;
}
