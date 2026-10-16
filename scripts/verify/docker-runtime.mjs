// Fixed shared host-only runtime identity boundary; never contacts Docker.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function parsePsIdentity(raw) {
  const found = { backend: [], guest: [] };
  for (const line of raw.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(line);
    if (!match) continue;
    const command = match[4];
    for (const [kind, exact] of [
      ['backend', '/Applications/Docker.app/Contents/MacOS/com.docker.backend'],
      ['guest', '/Applications/Docker.app/Contents/MacOS/com.docker.virtualization'],
    ]) if (command === exact || command.startsWith(`${exact} `)) {
      found[kind].push({ pid: Number(match[1]), ppid: Number(match[2]), started: match[3].trim() });
    }
  }
  if (found.backend.length !== 1 || found.guest.length !== 1 ||
      found.guest[0].ppid !== found.backend[0].pid) return null;
  return { backend: found.backend[0], guest: found.guest[0] };
}
export function assertAdmittedDockerGuest(expected, command = (binary, args) => execFileSync(binary, args,
  { encoding: 'utf8', timeout: 15000 })) {
  const actual = parsePsIdentity(command('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command=']));
  if (!actual || !expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error('admitted Docker backend or guest changed before Docker operation');
  }
  return actual;
}

// The fixed outer caller uses this host-only CLI for the same strict parser.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--observe') throw Error('expected --observe');
    const identity = parsePsIdentity(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='],
      { encoding: 'utf8', timeout: 15000 }));
    console.log(JSON.stringify(identity));
    process.exitCode = identity ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
