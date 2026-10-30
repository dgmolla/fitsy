import type { RestaurantResult } from '@fitsy/shared';
import { hasMapCoordinate, mapRestaurantLabel } from './discoveryMap';

const restaurant = { name: 'Flor do Ave', cuisineTags: ['Portuguese'], lat: 34.04, lng: -118.24 } as RestaurantResult;

it('uses actual coordinates and cuisine without inventing missing locations or labels', () => {
  expect(hasMapCoordinate(restaurant)).toBe(true);
  expect(mapRestaurantLabel(restaurant)).toBe('Flor do Ave · Portuguese');
  expect(mapRestaurantLabel({ ...restaurant, cuisineTags: [' ', 'Korean', 'BBQ'] })).toBe('Flor do Ave · Korean, BBQ');
  expect(mapRestaurantLabel({ ...restaurant, cuisineTags: [] })).toBe('Flor do Ave · Restaurant');
});

it.each([[NaN, 0], [0, Infinity], [91, -118], [34, -181], [0, 0]])('rejects unusable coordinates (%s, %s)', (lat, lng) => {
  expect(hasMapCoordinate({ ...restaurant, lat, lng })).toBe(false);
});

it.each([[0, -118], [34, 0], [-90, 180]])('keeps valid equator, meridian and boundary coordinates (%s, %s)', (lat, lng) => {
  expect(hasMapCoordinate({ ...restaurant, lat, lng })).toBe(true);
});
