// Verified against the PubMed abstracts on Nov 18 2026 (#970). Keep the wording
// no stronger than the abstracts say: these are associations, not promises.
export const STUDIES = {
  // Hill et al., Science 2003: ~100 kcal/day could prevent weight gain in most of the population.
  smallChanges: { label: 'Hill 2003', url: 'https://pubmed.ncbi.nlm.nih.gov/12574618/' },
  // Westenhoefer et al., Int J Eat Disord 1999: flexible control linked to lower BMI and a higher probability of successful weight reduction.
  flexibleEating: { label: 'Westenhoefer 1999', url: 'https://pubmed.ncbi.nlm.nih.gov/10349584/' },
  // Mertens et al., PNAS 2022 (200+ studies): choice architecture changes behavior, and food choices are particularly responsive.
  choiceDesign: { label: 'Mertens 2022', url: 'https://pubmed.ncbi.nlm.nih.gov/34983836/' },
} as const;

/** One short line for the whole slide; each study opens from its own link (#970). */
export const STUDY_NOTE = 'Based on research on small, steady changes, flexible eating and how choices are laid out.';
