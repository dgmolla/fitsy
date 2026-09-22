export const TRIED_OPTIONS = [
  { id: 'meal_prep', label: 'Meal prepping at home', icon: '🥦' },
  { id: 'calorie_apps', label: 'Calorie counting apps', icon: '📱' },
  { id: 'check_online', label: 'Looking up macros online', icon: '🔍' },
  { id: 'nothing', label: "Haven't really tried", icon: '🤷' },
] as const;

export type TriedApproach = typeof TRIED_OPTIONS[number]['id'];

const PITCHES = {
  meal_prep: {
    headline: "For the meals\nyou don’t cook.",
    body: "Keep your goals in reach when cooking isn’t in the plan.",
    payoff: "Different plans. The same targets in mind.",
    payoffTitle: "Your fitness plan\ncan come with you.",
    payoffBody: "Find restaurant meals around your targets, so a meal out can still support your goal.",
    stages: ["A meal at home", "A meal out", "The same fitness goal"],
    diagram: "two_paths",
    preview: 'Find something you feel like eating. Your meal targets come with you.',
    firstTip: 'search',
  },
  calorie_apps: {
    headline: "Use your numbers\nbefore you order.",
    body: "Turn the targets you already track into restaurant options.",
    payoff: "Put your fitness plan into your next order.",
    payoffTitle: "Hit your meal targets.\nEnjoy eating out.",
    payoffBody: "Find meals around your calories and protein, instead of logging a surprise later.",
    stages: ["Calories + protein", "Choose before you order", "Stay on track"],
    diagram: "bridge",
    preview: 'Compare the numbers below. Edit your meal targets to see different picks.',
    firstTip: 'macros',
  },
  check_online: {
    headline: "Less menu hunting.\nMore choosing.",
    body: "Find calories, protein and nutrition sources in one search.",
    payoff: "Less research between you and a meal that works.",
    payoffTitle: "Keep your fitness goals\non the menu.",
    payoffBody: "See calories and protein before you order, so eating out can support your goals.",
    stages: ["Your meal targets", "Meals compared for you", "Your fitness goal"],
    diagram: "bridge",
    preview: 'Compare meals side by side. Each pick labels its nutrition source.',
    firstTip: 'restaurant',
  },
  nothing: {
    headline: "Start with\nyour next meal.",
    body: "Get help with meal targets, then explore what to eat nearby.",
    payoff: "A starting point for eating toward your goals.",
    payoffTitle: "Make your goal\nan easier next meal.",
    payoffBody: "Fitsy helps turn fitness goals into meal targets, then into options you can order.",
    stages: ["Editable meal targets", "Your next restaurant meal", "A step toward your goal"],
    diagram: "bridge",
    preview: 'Start with one craving. You can adjust your meal targets as you go.',
    firstTip: 'macros',
  },
} as const;

export function onboardingPitch(tried?: TriedApproach) {
  return tried && Object.prototype.hasOwnProperty.call(PITCHES, tried) ? PITCHES[tried] : PITCHES.nothing;
}
