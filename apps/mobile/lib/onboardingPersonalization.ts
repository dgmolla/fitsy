export const TRIED_OPTIONS = [
  { id: 'meal_prep', label: 'Meal prepping', icon: '🥦' },
  { id: 'calorie_apps', label: 'Calorie counting apps', icon: '📱' },
  { id: 'check_online', label: 'Looking up macros online', icon: '🔍' },
  { id: 'nothing', label: "Haven't really tried", icon: '🤷' },
] as const;

export type TriedApproach = typeof TRIED_OPTIONS[number]['id'];

const PITCHES = {
  meal_prep: {
    headline: "For the meals\nyou don't cook.",
    body: 'Keep the routine that works for you. When eating out is easier, find nearby meals that work with your targets.',
    payoff: 'More options for the days plans change.',
    preview: 'Find something you feel like eating. Your meal targets come with you.',
    firstTip: 'search',
  },
  calorie_apps: {
    headline: 'Know what fits\nbefore you order.',
    body: 'Bring your targets. Find nearby meals that work with them before you decide what to order.',
    payoff: 'Your targets. More choices on the menu.',
    preview: 'Compare the numbers below. Edit your meal targets to see different picks.',
    firstTip: 'macros',
  },
  check_online: {
    headline: 'Less menu hunting.\nMore choosing.',
    body: 'Compare nearby meals in one place. See which nutrition comes from published information and which is estimated.',
    payoff: 'Know where the numbers come from.',
    preview: 'Compare meals side by side. Each pick labels its nutrition source.',
    firstTip: 'restaurant',
  },
  nothing: {
    headline: 'Start with\nyour next meal.',
    body: 'You can start small. We can help set editable meal targets, then show you nearby options to try.',
    payoff: 'One meal. A little less guesswork.',
    preview: 'Start with one craving. You can adjust your meal targets as you go.',
    firstTip: 'macros',
  },
} as const;

export function onboardingPitch(tried?: TriedApproach) {
  return tried && Object.prototype.hasOwnProperty.call(PITCHES, tried) ? PITCHES[tried] : PITCHES.nothing;
}
