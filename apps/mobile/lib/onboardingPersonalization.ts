export const TRIED_OPTIONS = [
  { id: 'meal_prep', label: 'Meal prepping at home', icon: '🥦' },
  { id: 'calorie_apps', label: 'Calorie counting apps', icon: '📱' },
  { id: 'check_online', label: 'Looking up macros online', icon: '🔍' },
  { id: 'nothing', label: "Haven't really tried", icon: '🤷' },
] as const;

export type TriedApproach = typeof TRIED_OPTIONS[number]['id'];

const PITCHES = {
  meal_prep: {
    approach: 'meal_prep',
    headline: "You’ve got home.\nWe’ve got meals out.",
    body: "Meal prep works until plans change. Find a restaurant meal for the nights you don’t cook.",
    payoff: 'Keep your meal targets, even when plans change.',
    payoffTitle: "A night out.\nStill your kind of meal.",
    payoffBody: 'Search around the calories and protein you already plan for, wherever dinner takes you.',
    preview: 'Find something you feel like eating. Your meal targets come with you.',
    firstTip: 'search',
  },
  calorie_apps: {
    approach: 'calorie_apps',
    headline: "That restaurant dish\ncan be hard to find.",
    body: 'When your tracker leaves you searching, Fitsy helps you explore restaurant dishes and their nutrition.',
    payoff: 'Choose with nutrition in view before you order.',
    payoffTitle: "From a dish name\nto an informed order.",
    payoffBody: 'See calories, protein and the nutrition source together. Use your existing targets to narrow your choices.',
    preview: 'Compare the numbers below. Edit your meal targets to see different picks.',
    firstTip: 'macros',
  },
  check_online: {
    approach: 'check_online',
    headline: "We’ll collect the macros.\nYou choose the meal.",
    body: 'Skip the menu-to-menu research. Fitsy brings restaurant nutrition together in one place.',
    payoff: 'Your targets turn a long menu into a shortlist.',
    payoffTitle: "Collected for you.\nFiltered for your targets.",
    payoffBody: 'Set your calories and protein, then explore dishes that fit. Open any meal to check its nutrition source.',
    preview: 'Compare meals side by side. Your targets guide every pick.',
    firstTip: 'restaurant',
  },
  nothing: {
    approach: 'nothing',
    headline: "A simple place\nto start.",
    body: 'You don’t need a whole new routine. Start with something you feel like eating.',
    payoff: 'One meal is enough to get started.',
    payoffTitle: "Your next meal.\nYour first small step.",
    payoffBody: 'We’ll help you set editable meal targets, then show you nearby options. You can adjust as you learn.',
    preview: 'Start with one craving. You can adjust your meal targets as you go.',
    firstTip: 'macros',
  },
} as const;

export function onboardingPitch(tried?: TriedApproach) {
  return tried && Object.prototype.hasOwnProperty.call(PITCHES, tried) ? PITCHES[tried] : PITCHES.nothing;
}


const GOAL_STORIES = {
  lose_fat: {
    title: 'Keep your fat-loss goal\non the menu.',
    body: 'Find meals around your calorie and protein targets, so eating out has a place in your plan.',
    label: 'Consistency with your fat-loss plan',
    habit: 'A meal that fits your targets',
  },
  build_muscle: {
    title: 'Bring your muscle-building\nplan to the table.',
    body: 'Find protein-forward meals with room for the energy your training needs.',
    label: 'Consistency with your muscle-building plan',
    habit: 'Protein and energy for your plan',
  },
  performance: {
    title: 'Fuel the work\nyou put in.',
    body: 'Find meals around your energy and macro targets, including the days you train and eat out.',
    label: 'Consistency with your training nutrition',
    habit: 'A meal to support your training',
  },
  maintain: {
    title: 'Make room for\nyour everyday balance.',
    body: 'Keep your usual meal targets in view as your schedule and restaurant plans change.',
    label: 'Consistency with your maintenance plan',
    habit: 'A meal that fits your routine',
  },
} as const;

export function onboardingGoalStory(goal?: string) {
  return goal && Object.prototype.hasOwnProperty.call(GOAL_STORIES, goal)
    ? GOAL_STORIES[goal as keyof typeof GOAL_STORIES] : GOAL_STORIES.maintain;
}
