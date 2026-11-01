import type { RestaurantResult } from '@fitsy/shared';
import type { ImageRequireSource } from 'react-native';

// Display-only national menu sample, never used for location, ranking or navigation.
// Published nutrition for 8 nuggets without sauce, verified 2026-10-31:
// https://www.chick-fil-a.com/menu/entrees/grilled-nuggets
// Bundled photo from that page:
// https://www.chick-fil-a.com/wp-content/uploads/sites/2/2025/06/grilledNuggets_8ct_PDP.png?w=1024
export const RESUBSCRIBE_SAMPLE: RestaurantResult = {
  id: 'sample-chick-fil-a',
  name: 'Chick-fil-A',
  address: '',
  lat: 0,
  lng: 0,
  distanceMiles: 0,
  cuisineTags: ['chicken'],
  chainFlag: true,
  bestMatch: {
    menuItemId: 'sample-chick-fil-a-grilled-nuggets-8',
    name: '8 ct Grilled Nuggets',
    calories: 130,
    proteinG: 25,
    carbsG: 1,
    fatG: 3,
    confidence: 'HIGH',
    nutritionBasis: 'published',
    matchScore: null,
  },
};

export const RESUBSCRIBE_SAMPLE_IMAGE: ImageRequireSource = require('@/assets/samples/chick-fil-a-grilled-nuggets.png');
