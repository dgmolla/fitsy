/**
 * Basic profanity gate for public-facing text (the feedback board, which
 * unlike the private feedback inbox is visible to every user). Backed by
 * `obscenity`, which matches common evasions (leetspeak, spacing, repeated
 * letters) via its recommended transformers rather than a plain substring
 * check.
 */

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}
