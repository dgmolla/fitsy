jest.unmock('react-native');
import React from 'react';
import { act, render, within } from '@testing-library/react-native';
import { OnboardingApproachStory } from './OnboardingApproachStory';
import { OnboardingFitnessPayoff } from './OnboardingFitnessPayoff';
import { OnboardingGoalGraph } from './OnboardingGoalGraph';
import { onboardingPitch, TRIED_OPTIONS } from '@/lib/onboardingPersonalization';

describe('personalized onboarding illustrations', () => {
  const approachArtwork = {
    check_online: {
      story: ['YOUR RESEARCH, BROUGHT TOGETHER', 'Restaurant menu', 'Nutrition page', 'One place to compare'],
      payoff: ['YOUR SHORTLIST STARTS HERE', 'Your meal targets', 'Calorie range', 'Protein target'],
    },
    calorie_apps: {
      story: ['RECOGNIZE THIS SEARCH?', 'That bowl from lunch…', 'Which entry is my dish?'],
      payoff: ['THE DISH, WITH MORE CONTEXT', 'Nutrition source', 'Published or estimated'],
    },
    meal_prep: {
      story: ['SOME DAYS GO TO PLAN', 'MON', '“Dinner out tonight?”', 'A RESTAURANT OPTION'],
      payoff: ['ONE PLAN. ROOM FOR BOTH.', 'A meal at home', 'A meal out', 'The same meal targets'],
    },
    nothing: {
      story: ['START WITH WHAT SOUNDS GOOD', '🥙', 'Something fresh', 'Something cozy'],
      payoff: ['NO PERFECT ROUTINE REQUIRED', 'Set a starting point', 'Find something nearby', 'Choose your next meal'],
    },
  } as const;

  it.each(TRIED_OPTIONS)('renders two different visual stories for $id', async ({ id }) => {
    const screen = render(<><OnboardingApproachStory approach={id} /><OnboardingFitnessPayoff pitch={onboardingPitch(id)} /></>);
    await act(async () => {});
    const story = within(screen.getByTestId(`story-${id}`));
    const payoff = within(screen.getByTestId(`payoff-${id}`));
    for (const label of approachArtwork[id].story) expect(story.getByText(label)).toBeTruthy();
    for (const label of approachArtwork[id].payoff) expect(payoff.getByText(label)).toBeTruthy();
    for (const other of TRIED_OPTIONS.filter(option => option.id !== id)) {
      expect(screen.queryByTestId(`story-${other.id}`)).toBeNull();
      expect(screen.queryByTestId(`payoff-${other.id}`)).toBeNull();
    }
  });
  it('labels the comparison as conceptual in visible and accessible text', () => {
    const screen = render(<OnboardingGoalGraph goal="build_muscle" />);
    expect(screen.getByText('With Fitsy')).toBeTruthy();
    expect(screen.getByText('Without Fitsy')).toBeTruthy();
    expect(screen.getByText(/Illustration only, not measured results/)).toBeTruthy();
    expect(screen.getByLabelText(/Illustrative consistency with your muscle-building plan/)).toBeTruthy();
  });
  it('describes target ranking without promising hard meal filters', () => {
    const screen = render(<OnboardingFitnessPayoff pitch={onboardingPitch('check_online')} />);
    expect(screen.getByText('Collected nutrition. Choices ranked around your targets.')).toBeTruthy();
    expect(screen.queryByText(/Choices filtered/)).toBeNull();
  });
  it('updates the graph context when the chosen goal changes', () => {
    const screen = render(<OnboardingGoalGraph goal="lose_fat" />);
    expect(screen.getByText('Consistency with your fat-loss plan')).toBeTruthy();
    screen.rerender(<OnboardingGoalGraph goal="performance" />);
    expect(screen.getByText('Consistency with your training nutrition')).toBeTruthy();
    expect(screen.queryByText('Consistency with your fat-loss plan')).toBeNull();
  });
});
