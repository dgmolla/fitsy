import { onboardingGoalStory, onboardingPitch, TRIED_OPTIONS } from './onboardingPersonalization';

describe('onboarding personalization', () => {
  it('keeps each prior approach distinct across both followups', () => {
    const pitches = TRIED_OPTIONS.map(({ id }) => onboardingPitch(id));
    expect(new Set(pitches.map(pitch => pitch.headline)).size).toBe(4);
    expect(new Set(pitches.map(pitch => pitch.payoffTitle)).size).toBe(4);
    expect(pitches.map(pitch => pitch.approach)).toEqual(TRIED_OPTIONS.map(option => option.id));
  });
  it('provides a gentle starting point when the previous choice is missing', () => {
    expect(onboardingPitch().approach).toBe('nothing');
  });
  it('explains the actual restaurant lookup gap without a universal tracker claim', () => {
    const pitch = onboardingPitch('calorie_apps');
    expect(pitch.headline).toContain('can be hard to find');
    expect(pitch.payoffBody).toContain('nutrition source');
  });
  it('connects all goals to distinct habits and supports legacy maintenance', () => {
    const stories = ['lose_fat', 'build_muscle', 'performance', 'maintain'].map(onboardingGoalStory);
    expect(new Set(stories.map(story => story.habit)).size).toBe(4);
    expect(onboardingGoalStory('performance').body).toContain('train');
    expect(onboardingGoalStory()).toEqual(onboardingGoalStory('maintain'));
    expect(onboardingGoalStory('unknown')).toEqual(onboardingGoalStory('maintain'));
  });
});
