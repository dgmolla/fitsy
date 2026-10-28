// External database-driver boundary only. Never replace Fitsy modules or open a DB.
const { appendFileSync } = require('node:fs');
const Module = require('node:module');
const load = Module._load;
Module._load = function (id, parent, isMain) {
  const real = load.call(this, id, parent, isMain);
  if (id !== '@prisma/client') return real;
  return { ...real, PrismaClient: class {
    constructor() {
      appendFileSync(process.env.FITSY_TEST_DB_CLIENT_LOG, 'client constructed\n');
      throw new Error('Synthetic database driver stopped before connection');
    }
  } };
};
