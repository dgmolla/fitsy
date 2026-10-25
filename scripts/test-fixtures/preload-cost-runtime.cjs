// External boundaries for the real preload CLI. No Fitsy modules are replaced.
const { appendFileSync } = require('node:fs');
const Module = require('node:module');
const load = Module._load;
let calls = 0;
const record = (value) => appendFileSync(process.env.PRELOAD_TEST_EVENTS, JSON.stringify(value) + '\n');
const count = Number(process.env.PRELOAD_TEST_ITEMS || 2);
const items = Array.from({ length: count }, (_, i) => ({ uuid: `dish-${i}`, title: `Chicken bowl ${i}`, price: 1200 }));
const restaurants = Array.from({ length: Number(process.env.PRELOAD_TEST_RESTAURANTS || 1) }, (_, i) => ({
  id: `restaurant-${i}`, storeUuid: `store-${i}`, name: `Test Kitchen ${i}`, brandId: null,
  address: '123 Test St', lat: 34.05, lng: -118.25,
  homeHex: process.env.PRELOAD_TEST_SPLIT_HEXES ? require('h3-js').latLngToCell(34.05 + i * 0.05, -118.25, 7) : '8729a1d75ffffff',
  photoUrl: 'https://example.test/hero.jpg', photoSource: 'ue_feed_hero', lastScrapedAt: null, menuHash: null,
}));
class Database {
  brand = { findMany: async () => [] };
  chainItem = { findMany: async () => [] };
  pipelineCompletedHex = {
    findMany: async () => [], findFirst: async () => null, count: async () => 0,
    create: async ({ data }) => { record({ type: 'db_checkpoint', ...data }); return data; },
  };
  async $queryRaw(strings, ...values) {
    const sql = strings.join('?');
    if (sql.includes('COUNT(DISTINCT mi.id)')) return restaurants.map(r => ({ restaurantId: r.id, itemCount: BigInt(count), macroCount: BigInt(count) }));
    if (sql.includes('INSERT INTO "MenuItem"')) return values[0].map(id => ({ id }));
    if (sql.includes('FROM "Restaurant"') && sql.includes("'ue_feed'")) return restaurants;
    return [];
  }
  async $executeRaw() { return 1; }
  async $transaction(operation) { record({ type: 'db_transaction' }); return operation(this); }
  async $disconnect() { record({ type: 'db_disconnect' }); }
}
Module._load = function (id, parent, isMain) {
  const real = load.call(this, id, parent, isMain);
  if (id === '@prisma/client') return { ...real, PrismaClient: Database };
  if (id === '@axiomhq/js') return { Axiom: class {
    ingest(_dataset, events) { events.forEach(record); }
    async flush() { record({ type: 'telemetry_flush' }); }
  } };
  if (id === '@anthropic-ai/sdk') {
    if (process.env.PRELOAD_TEST_REAL_SDK) {
      class Client extends (real.default || real) {
        constructor(options) { super({ ...options, fetch: global.fetch }); }
      }
      return { ...real, __esModule: true, default: Client };
    }
    class Client {
      messages = { create: async (params) => {
        const text = params.messages[0].content;
        const batch = JSON.parse(text.slice(text.indexOf('\n') + 1));
        const call = ++calls;
        record({ type: 'ai_request', items: batch.length });
        if (process.env.PRELOAD_TEST_DELAY) await new Promise(resolve => setTimeout(resolve, call * 20));
        return { id: 'test-message', model: params.model,
          usage: process.env.PRELOAD_TEST_INVALID_USAGE || Number(process.env.PRELOAD_TEST_INVALID_USAGE_CALL) === call
            ? undefined : { input_tokens: 1000, output_tokens: 2000 },
          content: [{ type: 'text', text: process.env.PRELOAD_TEST_MALFORMED_ONCE && call === 1 ? '{invalid json' : JSON.stringify(batch.map(item => ({
            name: item.name, sourceItemId: item.sourceItemId, cal: 500, p: 30, c: 50, f: 20, conf: 'HIGH',
          }))) }],
        };
      } };
    }
    Client.APIError = real.APIError;
    return { ...real, __esModule: true, default: Client };
  }
  return real;
};
global.fetch = async (url, options) => {
  const address = String(url);
  if (address.includes('foods.fatsecret.com')) return new Response('', { status: 404 });
  if (address.includes('getFeedV1')) return Response.json({ data: { feedItems: [{}] } });
  if (address.includes('getStoreV1')) return Response.json({ status: 'success', data: {
    title: 'Test Kitchen', catalogSectionsMap: { mains: [{ payload: {
      standardItemsPayload: { title: { text: 'Mains' }, catalogItems: items },
    } }] },
  } });
  if (address === 'https://api.anthropic.com/v1/models/claude-haiku-4-5') {
    record({ type: 'preflight', method: options.method || 'GET' });
    return Response.json({ id: 'claude-haiku-4-5' });
  }
  if (address === 'https://api.anthropic.com/v1/messages' && process.env.PRELOAD_TEST_REAL_SDK) {
    const params = JSON.parse(options.body);
    const text = params.messages[0].content;
    const batch = JSON.parse(text.slice(text.indexOf('\n') + 1));
    const call = ++calls;
    record({ type: 'ai_request', items: batch.length });
    if (call === 1) return Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'Test retry' } },
      { status: 429, headers: { 'retry-after': '0.1' } });
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ id: `test-${call}`, type: 'message', role: 'assistant', model: params.model,
      usage: { input_tokens: 1000, output_tokens: 2000 }, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(batch.map(item => ({
        name: item.name, sourceItemId: item.sourceItemId, cal: 500, p: 30, c: 50, f: 20, conf: 'HIGH',
      }))) }],
    });
  }
  throw new Error(`Unexpected external request: ${address}`);
};
