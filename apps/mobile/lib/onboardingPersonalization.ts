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
    preview: 'Find something you feel like eating. Your meal targets come with you.',
    firstTip: 'search',
  },
  calorie_apps: {
    approach: 'calorie_apps',
    headline: "That restaurant dish\ncan be hard to find.",
    body: 'When your tracker leaves you searching, Fitsy helps you explore restaurant dishes and their nutrition.',
    preview: 'Compare the numbers below. Edit your meal targets to see different picks.',
    firstTip: 'macros',
  },
  check_online: {
    approach: 'check_online',
    headline: "We’ll collect the macros.\nYou choose the meal.",
    body: 'Skip the menu-to-menu research. Fitsy brings restaurant nutrition together in one place.',
    preview: 'Compare meals side by side. Your targets guide every pick.',
    firstTip: 'restaurant',
  },
  nothing: {
    approach: 'nothing',
    headline: "A simple place\nto start.",
    body: 'You don’t need a whole new routine. Start with something you feel like eating.',
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
    label: 'Consistency with your fat-loss plan',
  },
  build_muscle: {
    title: 'Bring your muscle-building\nplan to the table.',
    label: 'Consistency with your muscle-building plan',
  },
  performance: {
    title: 'Fuel the work\nyou put in.',
    label: 'Consistency with your training nutrition',
  },
  maintain: {
    title: 'Make room for\nyour everyday balance.',
    label: 'Consistency with your maintenance plan',
  },
} as const;

export function onboardingGoalStory(goal?: string) {
  return goal && Object.prototype.hasOwnProperty.call(GOAL_STORIES, goal)
    ? GOAL_STORIES[goal as keyof typeof GOAL_STORIES] : GOAL_STORIES.maintain;
}

export function onboardingGoalPayoff(goal?: string, tried?: TriedApproach) {
  const focus = {
    lose_fat: 'calorie and protein targets',
    build_muscle: 'protein and energy targets',
    performance: 'energy and macro targets',
    maintain: 'usual meal targets',
  }[goal as keyof typeof GOAL_STORIES] ?? 'usual meal targets';
  const body = {
    meal_prep: `When dinner isn't prepped, keep your ${focus} in view.`,
    calorie_apps: `Compare dishes with your ${focus}, beyond tracker entries.`,
    check_online: `See restaurant nutrition together, with choices around your ${focus}.`,
    nothing: `Start with one nearby meal around your ${focus}. Adjust as you learn.`,
  }[tried ?? 'nothing'];
  return { title: onboardingGoalStory(goal).title, body };
}
