jest.unmock('react-native');
import React from 'react';
import { render, within } from '@testing-library/react-native';
import { OnboardingApproachStory } from './OnboardingApproachStory';
import { OnboardingGoalGraph } from './OnboardingGoalGraph';
import { onboardingGoalPayoff, TRIED_OPTIONS } from '@/lib/onboardingPersonalization';

it.each([
  ['meal_prep', ['🥘', '🍕', 'Meals at home', 'Dinner out']],
  ['calorie_apps', ['📱', '🤔', 'Your tracker', 'Which entry?']],
  ['check_online', ['📋', '🔍', 'Restaurant menus', 'Macro searches']],
  ['nothing', ['🥙', '🍜', 'Something fresh', 'Something cozy']],
] as const)('shows familiar emojis for %s', (approach, expected) => {
  const screen = render(<OnboardingApproachStory approach={approach} />);
  const story = within(screen.getByTestId(`story-${approach}`));
  for (const text of expected) expect(story.getByText(text)).toBeTruthy();
  for (const other of TRIED_OPTIONS.filter(option => option.id !== approach)) {
    expect(screen.queryByTestId(`story-${other.id}`)).toBeNull();
  }
});

it.each(['lose_fat', 'build_muscle', 'performance'] as const)(
  'tailors the graph page to each prior approach for %s', goal => {
    const descriptions = TRIED_OPTIONS.map(({ id }) => onboardingGoalPayoff(goal, id).body);
    expect(new Set(descriptions).size).toBe(TRIED_OPTIONS.length);
    for (const text of descriptions) expect(text.length).toBeLessThan(110);
  },
);

it('labels the graph as conceptual in visible and accessible text', () => {
  const screen = render(<OnboardingGoalGraph goal="build_muscle" />);
  expect(screen.getByText('With Fitsy')).toBeTruthy();
  expect(screen.getByText('Without Fitsy')).toBeTruthy();
  expect(screen.getByText('Conceptual paths, not measured results or a forecast.')).toBeTruthy();
  expect(screen.getByLabelText(/Illustrative consistency with your muscle-building plan/)).toBeTruthy();
});
