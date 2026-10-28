// Only external DB and HTTP boundaries are simulated. The actual CLI, matcher and writers run unchanged.
const fs = require('node:fs');
const Module = require('node:module');
const load = Module._load;
const record = value => fs.appendFileSync(process.env.V2_TEST_EVENTS, JSON.stringify(value) + '\n');
const checkpointPath = process.env.V2_TEST_EVENTS + '.db.json';
const names = ['WaBa Grill', 'No Data Chain', 'Unreviewed Chain', 'Independent Kitchen'];
const restaurants = names.map((name, i) => ({ id: `restaurant-${i}`, name, storeUuid: `store-${i}`, brandId: i < 3 ? `brand-${i}` : null,
  address: 'Fixture', lat: 34.05, lng: -118.25, source: 'ue_feed', homeHex: '8729a1d75ffffff', menuKind: 'restaurant' }));
function catalog() {
  const fixture = require('../../apps/api/tests/fixtures/chain-pilot.ts').capturedChainPilot[0];
  const { chainReviewHash } = require('../../apps/api/services/chainCatalog.ts');
  const item = require('../../apps/api/services/menuSources/ueApiClient.ts').parseStoreV1Response(fixture.ue).items[0];
  const row = { id: 'official-row', brandId: 'brand-0', canonicalKey: 'chicken-plate', ...fixture.official, source: 'official', confidence: 'HIGH', officialUrl: fixture.source.url };
  const review = { version: 1, sourceHash: fixture.source.sha256, locator: fixture.source.locator,
    reviewedBy: 'independent captured PDF fixture', aliases: [{ name: item.name, section: item.section, description: item.description }] };
  return [{ ...row, review: { ...review, dataHash: chainReviewHash(row, review) } }, { ...row, id: 'unreviewed-row', brandId: 'brand-2', review: null }];
}
class Database {
  constructor() {
    this.checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
    this.brand = { findMany: async () => names.slice(0, 3).map((name, i) => ({ id: `brand-${i}`, displayName: name, slug: name.toLowerCase(),
      aliases: [], detectionConf: 'high', menuKind: 'restaurant', macroSource: 'official', officialUrl: 'https://example.test/nutrition' })) };
    this.chainItem = { findMany: async () => catalog() };
    this.restaurant = { findMany: async ({ where }) => where.id ? restaurants.filter(r => where.id.in.includes(r.id)) : restaurants };
    this.macroEstimate = { findMany: async () => [] };
    this.pipelineCompletedHex = { findUnique: async ({ where }) => this.checkpoint?.runId === where.runId_hexId.runId && this.checkpoint.hexId === where.runId_hexId.hexId ? this.checkpoint : null,
      create: async ({ data }) => { if (process.env.V2_TEST_FAIL_CHECKPOINT) throw Error('Simulated DB failure'); this.checkpoint = data; return data; } };
  }
  async $queryRaw(strings, ...values) {
    const sql = strings.join('?');
    if (sql.includes('COUNT(DISTINCT mi.id)')) return restaurants.map(r => ({ restaurantId: r.id, itemCount: 1n, macroCount: 1n }));
    if (sql.includes('INSERT INTO "MenuItem"')) return values[0].map(id => ({ id }));
    return [];
  }
  async $executeRaw(strings, ...values) {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO "MacroEstimate"')) record({ type: 'db_estimates', sources: values[6], calories: values[1], reasoning: values[7] });
    if (sql.includes('SET "brandId" = b.brand')) return values[0].length;
    return 1;
  }
  async $transaction(operation) {
    record({ type: 'db_transaction' });
    const prior = this.checkpoint;
    try {
      const result = await operation(this);
      fs.writeFileSync(checkpointPath, JSON.stringify(this.checkpoint));
      record({ type: 'db_commit', checkpoint: this.checkpoint });
      if (process.env.V2_TEST_EXIT_AFTER_COMMIT) process.exit(0);
      return result;
    } catch (error) { this.checkpoint = prior; record({ type: 'db_rollback' }); throw error; }
  }
  async $disconnect() { record({ type: 'db_disconnect' }); }
}
Module._load = function (id, parent, isMain) {
  const real = load.call(this, id, parent, isMain);
  return id === '@prisma/client' ? { ...real, PrismaClient: Database } : real;
};
global.fetch = async (url, options) => {
  if (String(url).includes('getStoreV1')) {
    const { storeUuid } = JSON.parse(options.body); record({ type: 'ue_call', storeUuid });
    if (process.env.V2_TEST_EXIT_BETWEEN_RESTAURANTS && storeUuid === 'store-1') process.exit(0);
    if (process.env.V2_TEST_UE_FAIL) throw Error('Simulated unavailable menu');
    const captured = require('../../apps/api/tests/fixtures/chain-pilot.ts').capturedChainPilot[0].ue;
    const data = JSON.parse(JSON.stringify(captured));
    if (storeUuid === 'store-0') {
      const sections = Object.values(data.data.catalogSectionsMap);
      const payload = sections[0][0].payload.standardItemsPayload;
      payload.catalogItems.push({ uuid: 'seasonal', title: 'Seasonal Bowl', itemDescription: 'Chicken with rice', price: 1200 });
    }
    return Response.json(data);
  }
  if (String(url) === 'https://api.typesafe.ai/v1/systemone') {
    const request = JSON.parse(options.body); record({ type: 'jev_call', request });
    const answers = Object.fromEntries(Object.entries(request.questions).map(([macro, question]) => {
      const choice = Object.hasOwn(question.criteria, 'b0') ? (process.env.V2_TEST_OVERFLOW ? 'overflow'
        : macro === 'calories' ? 'b2' : macro === 'carbs' ? 'b2' : macro === 'fat' ? 'b0' : 'b1') : 'r5';
      return [macro, { type: 'choice', choice, confidence: .9, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
    }));
    return Response.json({ model: 'jev-1.14.0', answers, ...(process.env.V2_TEST_UNKNOWN_USAGE ? {} : { usage: { input_tokens: 100, output_tokens: 20 } }) });
  }
  throw Error('Unexpected external request: ' + String(url));
};
