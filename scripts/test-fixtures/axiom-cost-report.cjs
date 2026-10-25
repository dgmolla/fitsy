const { appendFileSync } = require('node:fs');
global.fetch = async (url, options) => {
  const body = options.body ? JSON.parse(options.body) : null;
  if (process.env.PRELOAD_TEST_SETUP) {
    appendFileSync(process.env.PRELOAD_TEST_QUERIES, JSON.stringify({ url, method: options.method, body }) + '\n');
    if (url.endsWith('/notifiers')) return Response.json([{ id: 'test-notifier', name: 'fitsy-pipeline-slack' }]);
    if (url.endsWith('/monitors') && options.method === 'GET') return Response.json([]);
    return Response.json({});
  }
  const { apl } = body;
  appendFileSync(process.env.PRELOAD_TEST_QUERIES, apl + '\n');
  const row = apl.includes('maxCost=') ? { maxCost: 0.011, inputTokens: 1000, outputTokens: 2000, itemAttempts: 2 }
    : apl.includes('project durationTotal') ? { durationTotal: '1s', restaurantsDiscovered: 1, restaurantsPersisted: 1, restaurantsFailed: 0, status: 'spend_cap' } : {};
  return Response.json({ tables: [{ fields: Object.keys(row).map(name => ({ name })), columns: Object.values(row).map(value => [value]) }] });
};
