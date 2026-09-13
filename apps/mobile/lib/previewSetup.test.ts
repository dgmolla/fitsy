const store: Record<string, string> = {};
const secure: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => { store[key] = value; },
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secure[key] ?? null,
  setItemAsync: async (key: string, value: string) => { secure[key] = value; },
}));
const targets = { calories: '600', protein: '40', carbs: '60', fat: '20' };
function setup() {
  let module!: typeof import('./previewSetup');
  jest.isolateModules(() => { module = require('./previewSetup'); });
  return module.getPreviewSetup();
}
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(secure)) delete secure[key];
});

it('upgrades an older install using its saved coordinates and preserves editable targets', async () => {
  store['@fitsy/onboarding'] = JSON.stringify({ goal: 'build_muscle' });
  store['@fitsy/macro_targets'] = JSON.stringify(targets);
  secure.fitsy_last_known_coords = JSON.stringify({ lat: 34.0522, lng: -118.2437 });
  const result = await setup();
  expect(result.targets).toEqual(targets);
  expect(result.data).toMatchObject({ goal: 'build_muscle', targetMode: 'known', area: { lat: 34.0522, lng: -118.2437, source: 'saved' } });
  expect(JSON.parse(store['@fitsy/onboarding']!)).toMatchObject(result.data);
});

it('keeps an explicitly chosen area and assisted setup over older cached data', async () => {
  const area = { name: 'DTLA', lat: 34.04, lng: -118.24, source: 'manual' };
  store['@fitsy/onboarding'] = JSON.stringify({ area, targetMode: 'estimate', targetBasis: 'existing' });
  store['@fitsy/macro_targets'] = JSON.stringify(targets);
  secure.fitsy_last_known_coords = JSON.stringify({ lat: 37.77, lng: -122.42 });
  expect((await setup()).data).toEqual({ area, targetMode: 'estimate', targetBasis: 'existing' });
});

it.each([null, { lat: 100, lng: 0 }, { lat: 0, lng: -200 }])('does not fabricate an area when saved coordinates are unavailable or invalid: %s', async coords => {
  if (coords) secure.fitsy_last_known_coords = JSON.stringify(coords);
  const result = await setup();
  expect(result.data.area).toBeUndefined();
  expect(result.targets).toBeNull();
  expect(store['@fitsy/onboarding']).toBeUndefined();
});
