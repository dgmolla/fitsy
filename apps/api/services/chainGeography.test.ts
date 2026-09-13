import { chainUsState, usStatesSchema } from './chainGeography';

test.each([
  ['CA', 34.0522, -118.2437], ['OH', 41.4993, -81.6944], ['NV', 36.1699, -115.1398],
  ['OR', 45.5152, -122.6784], ['WA', 47.6062, -122.3321], ['MA', 42.3601, -71.0589],
  ['DC', 38.9072, -77.0369], ['VA', 38.8048, -77.0469], ['MD', 39.2904, -76.6122],
  ['HI', 21.3069, -157.8583], ['AK', 61.2181, -149.9003], ['AK', 51.88, -176.65],
  // Attu site coordinate: https://dec.alaska.gov/Applications/SPAR/PublicMVC/CSP/SiteReport/2618
  ['AK', 52.8956, 172.9001], ['PR', 18.4655, -66.1057], ['GU', 13.4443, 144.7937],
])('offline boundary lookup: %s at %s,%s', (expected, lat, lng) => {
  const location = { lat: Number(lat), lng: Number(lng) };
  expect(chainUsState(location)).toBe(expected);
});
test.each([
  undefined, { lat: NaN, lng: -118 }, { lat: 34, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 },
  { lat: 0, lng: 0 }, { lat: 43.6532, lng: -79.3832 }, { lat: 32.5149, lng: -117.0382 },
  { lat: 36.999084, lng: -109.045223 }, { lat: 41.994944, lng: -119.999234 }, { lat: 0, lng: 179 },
])('unknown, foreign, ocean and border coordinates abstain: %p', location => {
  expect(chainUsState(location)).toBeUndefined();
});
test('scope requires recognized, nonempty, unique uppercase state codes', () => {
  expect(usStatesSchema.parse(['CA', 'DC'])).toEqual(['CA', 'DC']);
  for (const input of [[], ['XX'], ['ca'], ['CA', 'CA'], ['California'], ['US-CA'], ['CA', null], null]) {
    expect(usStatesSchema.safeParse(input).success).toBe(false);
  }
});
