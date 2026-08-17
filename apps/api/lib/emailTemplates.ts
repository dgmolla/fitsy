/**
 * Email templates for Fitsy marketing emails.
 *
 * brandEmailShell   — email-safe HTML wrapper (inline styles, Gmail/Apple Mail safe)
 * launchEmailContent — city-launch notification (moved from marketingEmail.ts)
 * WEEKLY_EDITIONS   — 8-edition editorial rotation
 * editionForDate    — deterministic weekly edition picker
 */

// ---------------------------------------------------------------------------
// Brand shell
// ---------------------------------------------------------------------------

export function brandEmailShell(opts: {
  preheader?: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const { preheader, bodyHtml, ctaText, ctaUrl } = opts;

  const preheaderHtml = preheader
    ? `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>`
    : "";

  const ctaHtml =
    ctaText && ctaUrl
      ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
          <tr>
            <td align="center">
              <a href="${ctaUrl}"
                 style="display:inline-block;background-color:#1B3A26;color:#FDFBF7;
                        font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                        font-size:15px;font-weight:600;text-decoration:none;
                        padding:14px 32px;border-radius:32px;mso-padding-alt:0;
                        letter-spacing:0.01em;"
                 target="_blank"
              >${ctaText}</a>
            </td>
          </tr>
        </table>`
      : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <title>Fitsy</title>
</head>
<body style="margin:0;padding:0;background-color:#FDFBF7;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheaderHtml}
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#FDFBF7;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;width:100%;background-color:#FFFFFF;
                      border:1px solid #E8E2D8;border-radius:16px;padding:36px 40px;"
               class="card">
          <!-- Wordmark -->
          <tr>
            <td style="padding-bottom:28px;border-bottom:1px solid #E8E2D8;">
              <span style="font-family:Georgia,serif;font-size:26px;font-weight:400;
                           color:#1B3A26;letter-spacing:-0.01em;">fitsy.</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding-top:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                       font-size:15px;line-height:1.65;color:#3A4F41;">
              ${bodyHtml}
              ${ctaHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Launch email (moved from marketingEmail.ts)
// ---------------------------------------------------------------------------

/**
 * Generates the subject and HTML body for a city-launch notification.
 * No footer — sendMarketingEmail appends it.
 */
export function launchEmailContent(city: string | null): {
  subject: string;
  html: string;
} {
  const where = city ? `in ${city}` : "in your city";
  const subject = `Fitsy just launched ${where}`;

  const bodyHtml = [
    `<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;`,
    `font-weight:400;color:#1B3A26;line-height:1.3;">We just went live ${where}.</h2>`,
    `<p style="margin:0 0 14px;">Great news — you asked us to let you know when Fitsy launched near you, so here we are.</p>`,
    `<p style="margin:0 0 14px;">We're live ${where} with hundreds of restaurants and thousands of menu items, each one mapped to its macros so you can find meals that actually fit your targets — protein, carbs, calories, whatever you're tracking.</p>`,
    `<p style="margin:0;">Open the app and tell it what you're after. We'll show you what's nearby.</p>`,
  ].join("");

  const html = brandEmailShell({
    preheader: `Fitsy is now live ${where} — find meals that fit your macros.`,
    bodyHtml,
    ctaText: "Open Fitsy",
    ctaUrl: "https://fitsy.org",
  });

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Weekly editions
// ---------------------------------------------------------------------------

type Edition = {
  slug: string;
  subject: string;
  build: () => { subject: string; html: string };
};

export const WEEKLY_EDITIONS: Edition[] = [
  // Edition 1 — restaurant-calorie-gap
  {
    slug: "restaurant-calorie-gap",
    subject: "Why restaurant calories are almost always higher than you think",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  The calorie gap no one talks about
</h2>
<p style="margin:0 0 14px;">
  A 2020 JAMA study measured 269 menu items from 31 restaurant chains and found the median dish ran
  about <strong>18% above</strong> its posted calorie count — with individual items swinging as far as
  <strong>+40%</strong>. The culprit isn't the protein or the starch. It's finishing fats.
</p>
<p style="margin:0 0 14px;">
  Restaurant cooks finish almost everything — pasta, vegetables, grilled fish — with a tablespoon or
  two of butter or oil before it leaves the pass. That's a routine 100–200 extra calories per dish
  that never makes it onto the nutrition label because portion drift and cook variation make it
  impossible to spec precisely.
</p>
<p style="margin:0 0 14px;">
  The practical upshot: treat restaurant calorie labels as a floor, not a ceiling.
  If you're tracking closely, building in a <strong>15–20% buffer</strong> on top of the listed number
  is a more honest estimate than taking it at face value.
</p>
<p style="margin:0 0 14px;">
  Three habits that help narrow the gap: ask for sauces and dressings on the side (gives you control),
  request "light oil" on grilled items (cooks often oblige), and log the dish as the higher end of
  any stated range when one is given.
</p>
<p style="margin:0;">
  Fitsy accounts for this when it estimates macros for independent restaurants — we use conservative
  upper estimates rather than optimistic ones, so what you log is more likely to be a slight
  overcount than a surprise undercount.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Restaurant dishes run 15–40% above their listed calories. Here's why — and what to do.",
          bodyHtml,
          ctaText: "Find meals that fit your macros",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 2 — protein-first-ordering
  {
    slug: "protein-first-ordering",
    subject: "The protein-anchor method for ordering out",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  Start with protein. Build outward.
</h2>
<p style="margin:0 0 14px;">
  Most people order by craving — they see a dish that sounds good and work backward to figure out
  whether it fits. The protein-anchor method flips that sequence: decide how much protein you need
  from this meal, find something on the menu that delivers it, and treat everything else as negotiable.
</p>
<p style="margin:0 0 14px;">
  A rough guide for protein targets per meal, based on common goal ranges:
</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Maintenance / general fitness:</strong> 30–40 g per meal</li>
  <li><strong>Active cut (deficit eating):</strong> 40–55 g — protein protects muscle when calories are low</li>
  <li><strong>Muscle-building phase:</strong> 40–60 g — frequency matters as much as total</li>
</ul>
<p style="margin:0 0 14px;">
  In practice this means scanning the menu for the protein first: a 6 oz chicken breast (~50 g),
  a double patty (~40 g), a salmon fillet (~34 g), a legume bowl (~22–28 g). Once you've identified
  two or three options that hit your target, you can choose between them on taste, price, or what
  sides they come with — rather than the other way around.
</p>
<p style="margin:0 0 14px;">
  The method works especially well at restaurants without published macros because protein is the
  easiest macro to estimate visually. A palm-sized portion of lean meat is reliably 25–30 g regardless
  of the cuisine.
</p>
<p style="margin:0;">
  Fitsy filters by protein target so you can run exactly this workflow — set a minimum protein,
  and let the menu come to you.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Pick your protein first. Everything else follows.",
          bodyHtml,
          ctaText: "Filter by protein near you",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 3 — sauce-math
  {
    slug: "sauce-math",
    subject: "Where 300–500 hidden calories actually live",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  The sauce problem
</h2>
<p style="margin:0 0 14px;">
  A grilled chicken sandwich is roughly 400 calories. Add the restaurant's "house aioli" and you're
  looking at 550–600. That's not a rounding error — that's an extra snack worth of calories from
  two tablespoons of an emulsified condiment.
</p>
<p style="margin:0 0 14px;">
  Here's where the arithmetic typically lives:
</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Caesar dressing (2 tbsp):</strong> 150–180 kcal, 16–18 g fat</li>
  <li><strong>Balsamic glaze (2 tbsp):</strong> 50–80 kcal — lighter than it tastes</li>
  <li><strong>Tzatziki (3 tbsp):</strong> 45–60 kcal — one of the better options</li>
  <li><strong>Chipotle aioli / "spicy mayo" (2 tbsp):</strong> 160–200 kcal</li>
  <li><strong>Peanut sauce (3 tbsp):</strong> 150–200 kcal, but carries 6–8 g protein</li>
</ul>
<p style="margin:0 0 14px;">
  The ask-on-the-side move is well-known but worth quantifying: if a restaurant uses 4 tablespoons
  of dressing on a salad and you use 1, you've just recovered 200+ calories without touching the
  food itself.
</p>
<p style="margin:0 0 14px;">
  One practical heuristic: anything described as "creamy," "rich," or named after a chef is almost
  certainly oil- or mayo-based and will run 100–200 kcal per tablespoon. Broth-based, vinegar-based,
  and citrus-based sauces are nearly always under 30 kcal per tablespoon.
</p>
<p style="margin:0;">
  When you find a restaurant on Fitsy, the macro estimates include typical sauce portions —
  but asking for dressings on the side will keep your actuals closer to those numbers.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Two tablespoons of house aioli can add 200 calories. Here's the math.",
          bodyHtml,
          ctaText: "See what's nearby",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 4 — menu-language
  {
    slug: "menu-language",
    subject: "A short glossary of menu words that matter",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  Reading between the lines
</h2>
<p style="margin:0 0 14px;">
  Menu language is marketing. Most of the words that make a dish sound appealing are also reliable
  signals about how it was cooked and what the macro breakdown will look like.
  Here's a short decoder:
</p>
<p style="margin:0 0 8px;font-weight:600;color:#1B3A26;">Higher calorie density — proceed with information:</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Crispy / golden:</strong> battered or pan-fried in oil — adds 150–300 kcal over the same item grilled</li>
  <li><strong>Creamy / velvety:</strong> dairy- or butter-based sauce — 100–200 extra kcal per serving</li>
  <li><strong>Glazed / sticky:</strong> sugar-reduced sauce — often 60–120 g carbs in itself</li>
  <li><strong>Loaded / smothered:</strong> usually cheese + sauce + more sauce</li>
  <li><strong>Braised:</strong> tender and delicious, but typically finished in the braising fat</li>
</ul>
<p style="margin:0 0 8px;font-weight:600;color:#1B3A26;">Lower calorie density — usually what it says:</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Grilled / charred:</strong> minimal added fat if done right; verify it isn't basted</li>
  <li><strong>Seared:</strong> high-heat, light oil — usually a better bet than "pan-fried"</li>
  <li><strong>Steamed / poached / broth-based:</strong> lowest fat-addition cooking methods</li>
  <li><strong>Dressed / vinaigrette:</strong> acid + small oil — far lighter than cream dressings</li>
</ul>
<p style="margin:0 0 14px;">
  None of these are rules — a "grilled" item marinated in teriyaki can be high in sugar,
  and a "crispy" item might be air-fried. But knowing the vocabulary gives you a reasonable
  prior before the macros are visible.
</p>
<p style="margin:0;">
  Fitsy shows actual estimated macros wherever we have them — so you can skip the guesswork
  and see the numbers directly.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Crispy, creamy, glazed, braised — what restaurant menu words actually mean for your macros.",
          bodyHtml,
          ctaText: "See real macros near you",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 5 — cut-vs-bulk-dining
  {
    slug: "cut-vs-bulk-dining",
    subject: "How eating out changes when you're cutting vs. building",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  Same restaurant, different strategy
</h2>
<p style="margin:0 0 14px;">
  Eating out looks very different depending on whether you're in a calorie deficit or surplus.
  The goal isn't to avoid restaurants — it's to use them differently.
</p>
<p style="margin:0 0 8px;font-weight:600;color:#1B3A26;">On a cut:</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li>Protein is your budget anchor — hit it, then fill remaining calories with volume (vegetables, broth)</li>
  <li>Alcohol is expensive calorically; even one drink can consume 15–20% of a deficit day's budget</li>
  <li>Sharing starters or skipping the bread basket saves 200–400 kcal with no satiety cost</li>
  <li>Ordering two appetizers or a protein + side instead of an entrée gives you more control</li>
  <li>Be suspicious of "healthy" grain bowls — check the macros; many run 700–900 kcal</li>
</ul>
<p style="margin:0 0 8px;font-weight:600;color:#1B3A26;">On a bulk:</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li>Restaurants are actually useful — hitting a surplus is harder than people expect</li>
  <li>Prioritize calorie density: whole grains, avocado, olive-oil-dressed dishes, nuts on salads</li>
  <li>Adding a side or a starter is the easiest way to add 300–500 clean calories</li>
  <li>Still hit protein first — muscle gain is protein-gated, not just calorie-gated</li>
</ul>
<p style="margin:0 0 14px;">
  In both cases the underlying skill is the same: knowing the macro profile of what you're ordering
  before you commit. Chain restaurants publish this. Independent restaurants mostly don't.
</p>
<p style="margin:0;">
  Fitsy estimates macros for indie spots so the information is available regardless of where you end up.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Eating out looks very different on a cut vs. a bulk. Here's how to use restaurants for both goals.",
          bodyHtml,
          ctaText: "Find meals that fit your goal",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 6 — healthy-halo
  {
    slug: "healthy-halo",
    subject: 'The "healthy bowl" trap — why salads often beat burgers',
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  Your salad probably has more calories than a cheeseburger
</h2>
<p style="margin:0 0 14px;">
  This isn't a gotcha — it's a reliable pattern. A standard cheeseburger at most mid-tier chains
  runs 500–650 kcal. A "harvest bowl" or "superfood salad" at the same type of restaurant will
  frequently clock 800–1,100 kcal because of what gets added on top.
</p>
<p style="margin:0 0 14px;">
  The toppings ladder — roughly ordered by caloric density:
</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Candied nuts (handful):</strong> 150–200 kcal</li>
  <li><strong>Avocado (half):</strong> 120 kcal, 11 g fat — healthy fat, still counts</li>
  <li><strong>Croutons (standard portion):</strong> 100–150 kcal</li>
  <li><strong>Cheese (1.5 oz):</strong> 120–170 kcal</li>
  <li><strong>Dried fruit (2 tbsp):</strong> 60–90 kcal</li>
  <li><strong>Creamy dressing (3 tbsp):</strong> 200–250 kcal</li>
</ul>
<p style="margin:0 0 14px;">
  Add those to a bed of greens and a protein, and 900 kcal is not unusual at all.
  The issue isn't that any of these ingredients are bad — it's that the "healthy" framing
  makes people less likely to look closely.
</p>
<p style="margin:0 0 14px;">
  The healthy halo effect is well-documented in behavioral research: people systematically
  underestimate calories in meals labeled "healthy," "fresh," or "clean" — and they tend to
  over-order sides when they think the main is virtuous.
</p>
<p style="margin:0;">
  Fitsy shows macros for bowls and salads too — because knowing is always better than assuming.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "A harvest bowl often has more calories than a cheeseburger. Here's the toppings math.",
          bodyHtml,
          ctaText: "See what's actually in your meal",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 7 — chain-vs-indie
  {
    slug: "chain-vs-indie",
    subject: "Chains publish macros. Indie spots don't. Here's how to handle both.",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  The information gap between chains and independent restaurants
</h2>
<p style="margin:0 0 14px;">
  In the US, any restaurant with 20 or more locations is legally required to publish calorie counts.
  That covers most fast food and casual-dining chains — Chipotle, McDonald's, Sweetgreen, Panera,
  and hundreds more. The information isn't always easy to find, but it exists.
</p>
<p style="margin:0 0 14px;">
  Independent restaurants — the local taco place, the neighborhood Thai spot, the ramen shop
  three blocks away — publish almost nothing. They typically can't: recipes vary by cook, portions
  vary by plate, and commissioning a lab analysis costs thousands of dollars per dish.
</p>
<p style="margin:0 0 14px;">
  When you're eating indie, a few methods give reasonable estimates:
</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>The plate method:</strong> visually divide the plate — half vegetables/greens, quarter protein, quarter starch — and estimate each section by reference portion</li>
  <li><strong>Reference portions:</strong> a palm-sized protein portion is ~25–30 g protein, a cupped handful of cooked rice is ~45 g carbs, a thumb of oil is ~15 g fat</li>
  <li><strong>Chain proxy:</strong> find the closest equivalent dish at a chain you know the macros for and use it as a baseline</li>
  <li><strong>Add 15–20%:</strong> independent kitchens typically use more oil and butter than home cooking; build in the buffer</li>
</ul>
<p style="margin:0 0 14px;">
  None of these are precise — but "roughly right" is vastly better than guessing zero or skipping
  the log entirely, which systematically underreports your actual intake.
</p>
<p style="margin:0;">
  Fitsy estimates indie restaurant macros using a combination of FatSecret data and AI estimation —
  so you're not starting from scratch every time you eat somewhere local.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "Chains publish calories by law. Independent spots don't. Here's how to estimate indie meals.",
          bodyHtml,
          ctaText: "Find nearby restaurants with macros",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },

  // Edition 8 — consistency-not-perfection
  {
    slug: "consistency-not-perfection",
    subject: "One restaurant meal never ruins a week. Here's the math.",
    build() {
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:400;color:#1B3A26;line-height:1.3;">
  The 80/20 of dining out and tracking
</h2>
<p style="margin:0 0 14px;">
  A pound of body fat is roughly 3,500 calories. To gain one pound in a week from eating out,
  you'd need to run a 500-calorie-per-day surplus every single day — not just overshoot one meal.
  One restaurant dinner, even a generous one, moves the weekly needle by one to three percent.
</p>
<p style="margin:0 0 14px;">
  The practical framing: if you're tracking across 21 meals a week and logging 17 of them well,
  that's 80% consistency. Research consistently shows 80% adherence is sufficient to see
  meaningful body composition change over time. Perfect logging isn't the goal; sustainable
  logging is.
</p>
<p style="margin:0 0 14px;">
  What actually matters more than any single meal:
</p>
<ul style="margin:0 0 14px;padding-left:20px;line-height:1.8;">
  <li><strong>Weekly protein total</strong> — distributing it over days matters more than any one-day spike or dip</li>
  <li><strong>Logging even rough estimates</strong> — "I had pasta, probably 700 kcal" beats nothing</li>
  <li><strong>Not skipping the next meal</strong> — "I'll compensate by skipping breakfast" reliably leads to worse outcomes than just resuming normal eating</li>
  <li><strong>Hydration post-restaurant</strong> — restaurant food is high sodium; water retention the next morning is water, not fat</li>
</ul>
<p style="margin:0 0 14px;">
  The only real recovery heuristic after a heavy dinner is simple: eat your normal next meal,
  hit your protein, and keep the week moving. The body's weekly average is what matters,
  not the Tuesday night burger.
</p>
<p style="margin:0;">
  Fitsy is built for real life — eating out included. Use it to make informed choices most of the time,
  not to stress about every meal.
</p>`;
      return {
        subject: this.subject,
        html: brandEmailShell({
          preheader: "One restaurant meal never ruins a week. Here's the math — and the actual recovery heuristics.",
          bodyHtml,
          ctaText: "Find meals that fit your week",
          ctaUrl: "https://fitsy.org",
        }),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Edition picker
// ---------------------------------------------------------------------------

/**
 * Returns the deterministic weekly edition for a given date.
 * Week 0 starts on Monday, January 5, 2026.
 * Rotation period: 8 editions (cycles indefinitely).
 */
export function editionForDate(date: Date): {
  slug: string;
  subject: string;
  html: string;
} {
  const EPOCH_MS = Date.UTC(2026, 0, 5); // Mon Jan 5 2026 00:00:00 UTC
  const weekMs = 7 * 86400e3;
  const weekIndex = Math.floor((date.getTime() - EPOCH_MS) / weekMs);
  const idx = ((weekIndex % 8) + 8) % 8;
  // idx is always in [0, 7] — the double-modulo guarantees it.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const edition = WEEKLY_EDITIONS[idx]!;
  const { subject, html } = edition.build();
  return { slug: edition.slug, subject, html };
}
