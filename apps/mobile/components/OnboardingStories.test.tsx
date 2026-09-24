jest.unmock('react-native');
import React from 'react';
import { act, render, within } from '@testing-library/react-native';
import { Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OnboardingApproachStory } from './OnboardingApproachStory';
import { OnboardingFitnessPayoff } from './OnboardingFitnessPayoff';
import { OnboardingGoalGraph } from './OnboardingGoalGraph';
import { onboardingPitch, TRIED_OPTIONS } from '@/lib/onboardingPersonalization';

describe('personalized onboarding illustrations', () => {
  const approachArtwork = {
    check_online: {
      story: ['YOUR RESEARCH, BROUGHT TOGETHER', 'Restaurant menu', 'Nutrition page', 'One place to compare'],
      payoff: ['YOUR SHORTLIST STARTS HERE', 'Your meal targets', 'Calorie range', 'Protein target'],
      storyIcons: ['globe-outline', 'reader-outline', 'globe-outline', 'arrow-down', 'layers-outline'],
      payoffIcons: ['options-outline', 'swap-vertical-outline'],
      storyImages: 0,
      payoffImages: 1,
    },
    calorie_apps: {
      story: ['RECOGNIZE THIS SEARCH?', 'That bowl from lunch…', 'Which entry is my dish?'],
      payoff: ['THE DISH, WITH MORE CONTEXT', 'Nutrition source', 'Published or estimated'],
      storyIcons: ['search-outline', 'help-circle-outline', 'restaurant-outline'],
      payoffIcons: ['flame-outline', 'barbell-outline', 'reader-outline'],
      storyImages: 0,
      payoffImages: 1,
    },
    meal_prep: {
      story: ['SOME DAYS GO TO PLAN', 'MON', '“Dinner out tonight?”', 'A RESTAURANT OPTION'],
      payoff: ['ONE PLAN. ROOM FOR BOTH.', 'A meal at home', 'A meal out', 'The same meal targets'],
      storyIcons: ['file-tray-full-outline', 'file-tray-full-outline', 'file-tray-full-outline', 'chatbubble-ellipses-outline'],
      payoffIcons: ['home-outline', 'restaurant-outline', 'locate-outline'],
      storyImages: 1,
      payoffImages: 0,
    },
    nothing: {
      story: ['START WITH WHAT SOUNDS GOOD', '🥙', 'Something fresh', 'Something cozy'],
      payoff: ['NO PERFECT ROUTINE REQUIRED', '1', 'Set a starting point', '2', 'Find something nearby', '3', 'Choose your next meal'],
      storyIcons: ['compass-outline'],
      payoffIcons: [],
      storyImages: 0,
      payoffImages: 0,
    },
  } as const;

  it.each(TRIED_OPTIONS)('renders two different visual stories for $id', async ({ id }) => {
    const screen = render(<><OnboardingApproachStory approach={id} /><OnboardingFitnessPayoff pitch={onboardingPitch(id)} /></>);
    await act(async () => {});
    const story = within(screen.getByTestId(`story-${id}`));
    const payoff = within(screen.getByTestId(`payoff-${id}`));
    for (const label of approachArtwork[id].story) expect(story.getByText(label)).toBeTruthy();
    for (const label of approachArtwork[id].payoff) expect(payoff.getByText(label)).toBeTruthy();
    expect(screen.getByTestId(`story-${id}`).findAllByType(Ionicons).map((icon: { props: { name: string } }) => icon.props.name)).toEqual(approachArtwork[id].storyIcons);
    expect(screen.getByTestId(`payoff-${id}`).findAllByType(Ionicons).map((icon: { props: { name: string } }) => icon.props.name)).toEqual(approachArtwork[id].payoffIcons);
    expect(screen.getByTestId(`story-${id}`).findAllByType(Image)).toHaveLength(approachArtwork[id].storyImages);
    expect(screen.getByTestId(`payoff-${id}`).findAllByType(Image)).toHaveLength(approachArtwork[id].payoffImages);
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
