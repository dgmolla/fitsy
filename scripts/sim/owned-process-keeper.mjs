import { spawn } from 'node:child_process';

// This process is the detached group leader for one native runner invocation.
// Only it may address the group by ID while it is alive.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

const [command, ...args] = process.argv.slice(2);
const report = message => { if (process.connected) process.send(message); };
let child;
let closing = false;
let commandExitObserved = false;
process.on('message', message => {
  if (message?.type === 'recorder-stop') {
    // This keeper observes both child exit and stop intent on one event loop.
    // IPC delivery to the runner may lag, so acknowledge the observed order here.
    report({ type: 'ack', id: message.id, commandExitedBeforeStop: commandExitObserved });
  } else if (message?.type === 'signal') {
    try {
      process.kill(-process.pid, message.signal);
      if (message.signal !== 'SIGKILL') report({ type: 'ack', id: message.id });
    } catch (error) { report({ type: 'ack', id: message.id, error: error.message }); }
  } else if (message?.type === 'close') {
    // The runner observed no other group member. With the keeper alone, no
    // descendant remains that could spawn a new member before it exits.
    closing = true;
    report({ type: 'ack', id: message.id });
    process.disconnect();
  }
});
process.on('disconnect', () => {
  if (closing) return;
  // The invoking runner vanished. Bound cleanup while this group ID is still ours.
  try { process.kill(-process.pid, 'SIGTERM'); } catch { /* group may be empty */ }
  setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { /* already gone */ } }, 5000);
});
try {
  child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], detached: false });
  child.once('spawn', () => report({ type: 'command-start', pid: child.pid }));
  child.once('error', error => { commandExitObserved = true; report({ type: 'command-exit', code: null, signal: null, error: error.message }); });
  child.once('exit', (code, signal) => { commandExitObserved = true; report({ type: 'command-exit', code, signal }); });
} catch (error) {
  commandExitObserved = true;
  report({ type: 'command-exit', code: null, signal: null, error: error.message });
}
