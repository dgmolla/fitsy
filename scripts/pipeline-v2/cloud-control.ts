import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import { parseRunStart } from './cloud-runs';
import { readPriorityBatch } from './rollout-priority';

/** This client needs invocation permission, never the pipeline database credential. */
export async function cloudControl(args: string[]): Promise<unknown> {
  const command = args[0], values = new Map<string, string>(), hexIds: string[] = [];
  if (!['start', 'status'].includes(command ?? '')) throw new Error('Use start or status with --url=PRIVATE_SERVICE_OR_LOCAL_PROXY');
  for (const arg of args.slice(1)) {
    const match = /^--(url|run-id|hex-id|max-hexes|budget-usd|priority-file)=(.+)$/.exec(arg);
    if (!match || (match[1] !== 'hex-id' && values.has(match[1]!))) throw new Error('Invalid or repeated cloud control option');
    if (match[1] === 'hex-id') hexIds.push(match[2]!); else values.set(match[1]!, match[2]!);
  }
  const runId = values.get('run-id') ?? '';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) throw new Error('An explicit run-id is required');
  const url = new URL(values.get('url') ?? '');
  const loopback = ['localhost', '[::1]'].includes(url.hostname) || (isIP(url.hostname) === 4 && url.hostname.split('.')[0] === '127');
  const proxy = url.protocol === 'http:' && loopback;
  if ((!proxy && (url.protocol !== 'https:' || !url.hostname.endsWith('.run.app'))) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a private Cloud Run HTTPS origin or a loopback IAM proxy');
  let body: string | undefined;
  if (command === 'start') {
    if (values.has('priority-file') && hexIds.length) throw new Error('Use priority-file or explicit hex-id values');
    const jobs = values.has('priority-file') ? readPriorityBatch(values.get('priority-file')!) : undefined;
    body = JSON.stringify(parseRunStart({ runId, hexIds: jobs?.map(job => job.hexId) ?? hexIds,
      ...(jobs ? { priorities: jobs.map(job => job.priority) } : {}),
      maxHexes: Number(values.get('max-hexes')), budgetUsd: Number(values.get('budget-usd')) }));
  } else if (hexIds.length || values.has('max-hexes') || values.has('budget-usd') || values.has('priority-file')) throw new Error('Status does not accept run limits');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!proxy) headers['Authorization'] = 'Bearer ' + execFileSync('gcloud', ['auth', 'print-identity-token'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
  const response = await fetch(url.origin + (command === 'start' ? '/runs' : '/runs/' + runId), {
    method: command === 'start' ? 'POST' : 'GET', headers, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Cloud control HTTP ${response.status}; inspect retained run status before retrying`);
  return response.json() as Promise<unknown>;
}
if (process.argv[1] && /[/\\]cloud-control\.ts$/.test(process.argv[1])) {
  void cloudControl(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => { console.error('Cloud control failed; check explicit limits, private service URL and IAM invocation permission'); process.exitCode = 1; });
}
