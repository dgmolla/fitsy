#!/usr/bin/env node
import { isMain } from './impact-plan.mjs';
import { assertOwnedDatabase, databaseControl, withOwnedLock } from './local-db-control.mjs';
export { assertOwnedDatabase, databaseControl, runWithLocalDatabase } from './local-db-control.mjs';

if (isMain(import.meta.url)) {
  try {
    if (process.argv[2] === '--assert-owned-db') assertOwnedDatabase();
    else if (process.argv[2] === '--stop-owned-db') process.exitCode = withOwnedLock('--locked-stop');
    else if (process.argv[2] === '--locked-stop') { databaseControl().stop(); console.log('Stopped this worktree\'s owned verification database.'); }
    else if (process.argv[2] === '--locked-run') {
      // The fixed CLI owns the pipeline; reusable DB helpers never import it.
      import('./run.mjs').then(async ({ verify }) => {
        if (typeof verify !== 'function') throw Error('canonical verifier does not export verify');
        return databaseControl().run(process.argv.slice(3), verify);
      })
        .then(status => { process.exitCode = status; })
        .catch(error => {
          console.log(JSON.stringify({ name: 'local-database', status: 'fail', summary: error.message,
            fix: 'repair the owned disposable database and rerun verification' }));
          process.exitCode = 1;
        });
    }
  } catch (error) {
    if (process.argv[2] === '--locked-run') console.log(JSON.stringify({ name: 'local-database', status: 'fail',
      summary: error.message, fix: 'repair the owned disposable database and rerun verification' }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
