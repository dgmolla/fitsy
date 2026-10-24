import { spawnSync } from 'node:child_process';

export type FixtureProcess = { pid: number; pgid: number; started: string };
export function fixtureProcess(pid: number, parent?: number): FixtureProcess | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8' });
  const fields = result.stdout.trim().split(/\s+/);
  if (result.status !== 0 || Number(fields[0]) !== pid || fields.length < 8 ||
      (parent !== undefined && Number(fields[1]) !== parent)) return undefined;
  return { pid, pgid: Number(fields[2]), started: fields.slice(3).join(' ') };
}
export function signalFixtureProcess(acquired: FixtureProcess | undefined, signal: NodeJS.Signals, group = false) {
  if (!acquired || !Number.isSafeInteger(acquired.pid) || acquired.pid <= 1) return false;
  const current = fixtureProcess(acquired.pid);
  if (!current || current.pgid !== acquired.pgid || current.started !== acquired.started ||
      (group && current.pgid !== acquired.pid)) return false;
  try { process.kill(group ? -acquired.pid : acquired.pid, signal); return true; }
  catch { return false; }
}
