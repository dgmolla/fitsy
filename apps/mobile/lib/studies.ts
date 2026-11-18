// Verified against the PubMed abstracts on Nov 18 2026 (#970). Keep the wording
// no stronger than the abstract says: these are associations, not promises.
export const STUDIES = {
  smallChanges: {
    // Hill et al., Science 2003: ~100 kcal/day could prevent weight gain in most of the population.
    text: 'Small, steady changes add up: about 100 kcal a day was estimated enough to prevent gradual weight gain in most people.',
    sourceLabel: 'Source',
    url: 'https://pubmed.ncbi.nlm.nih.gov/12574618/',
  },
  flexibleEating: {
    // Westenhoefer et al., Int J Eat Disord 1999: flexible control linked to lower BMI and a higher probability of successful weight reduction.
    text: 'Flexible, not all-or-nothing, eating is linked to better weight control.',
    sourceLabel: 'Source',
    url: 'https://pubmed.ncbi.nlm.nih.gov/10349584/',
  },
  choiceDesign: {
    // Mertens et al., PNAS 2022 (200+ studies): choice architecture changes behavior (small to medium effect), and food choices are particularly responsive.
    text: 'How options are laid out shapes what we pick, and food choices are especially responsive (a review of 200+ studies).',
    sourceLabel: 'Source',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34983836/',
  },
} as const;
