jest.unmock('react-native');
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { OnboardingApproachStory } from './OnboardingApproachStory';
import { OnboardingFitnessPayoff } from './OnboardingFitnessPayoff';
import { OnboardingGoalGraph } from './OnboardingGoalGraph';
import { onboardingPitch, TRIED_OPTIONS } from '@/lib/onboardingPersonalization';

describe('personalized onboarding illustrations', () => {
  it.each(TRIED_OPTIONS)('renders two different visual stories for $id', async ({ id }) => {
    const screen = render(<><OnboardingApproachStory approach={id} /><OnboardingFitnessPayoff pitch={onboardingPitch(id)} /></>);
    await act(async () => {});
    expect(screen.getByTestId(`story-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`payoff-${id}`)).toBeTruthy();
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
