import { onboardingGoalPayoff, onboardingGoalStory, onboardingPitch, TRIED_OPTIONS } from './onboardingPersonalization';

describe('onboarding personalization', () => {
  it('keeps each prior approach distinct across both payoff screens', () => {
    const pitches = TRIED_OPTIONS.map(({ id }) => onboardingPitch(id));
    expect(new Set(pitches.map(pitch => pitch.headline)).size).toBe(4);
    expect(new Set(TRIED_OPTIONS.map(({ id }) => onboardingGoalPayoff('lose_fat', id).body)).size).toBe(4);
    expect(pitches.map(pitch => pitch.approach)).toEqual(TRIED_OPTIONS.map(option => option.id));
  });
  it('provides a gentle starting point when the previous choice is missing', () => {
    expect(onboardingPitch().approach).toBe('nothing');
  });
  it('explains the actual restaurant lookup gap without a universal tracker claim', () => {
    const pitch = onboardingPitch('calorie_apps');
    expect(pitch.headline).toContain('can be hard to find');
    expect(onboardingGoalPayoff('lose_fat', 'calorie_apps').body).toContain('tracker entries');
  });
  it('connects all goals to distinct graph labels and supports legacy maintenance', () => {
    const stories = ['lose_fat', 'build_muscle', 'performance', 'maintain'].map(onboardingGoalStory);
    expect(new Set(stories.map(story => story.label)).size).toBe(4);
    expect(onboardingGoalPayoff('performance', 'meal_prep').body).toContain('energy and macro');
    expect(onboardingGoalStory()).toEqual(onboardingGoalStory('maintain'));
    expect(onboardingGoalStory('unknown')).toEqual(onboardingGoalStory('maintain'));
  });
});
