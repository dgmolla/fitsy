import s from "@/app/landing-sections.module.css";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import type { DisplayPricing } from "@/lib/pricing";
import { LAUNCH_CITY, LAUNCH_DATE_ISO, LAUNCH_DATE_LABEL } from "@/lib/launch";

/**
 * Static landing-page sections below the feature grid. Server components:
 * no state, no effects. Copy mirrors the onboarding flow (welcome/macros-fitsy,
 * welcome/how-it-works) so the site and the app tell the same story.
 */

export function HowItWorks() {
  return (
    <section className={s.section} id="how">
      <div className={s.container}>
        <div className={s.sectionHead}>
          <span className={s.eyebrow}>How it works</span>
          <h2 className={s.sectionTitle}>
            Three steps. You only do <em>one of them.</em>
          </h2>
        </div>
        <div className={s.steps}>
          <Step
            n="1"
            title="We help set your targets"
            tag="Fitsy does this"
            you={false}
          >
            Pick a goal, add your stats, and Fitsy turns them into per-meal
            protein, carb, and fat targets. Adjust them anytime.
          </Step>
          <Step
            n="2"
            title="We scan nearby menus"
            tag="Fitsy does this"
            you={false}
          >
            Every dish at every restaurant near you gets macros, then gets
            scored against your targets. Best fit rises to the top.
          </Step>
          <Step n="3" title="You pick and eat" tag="Your only job" you>
            Open a restaurant, see the match percent on every dish, order the
            one you actually want. No logging, no math.
          </Step>
        </div>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  tag,
  you,
  children,
}: {
  n: string;
  title: string;
  tag: string;
  you: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={s.step}>
      <div className={s.stepNum}>{n}</div>
      <h3 className={s.stepTitle}>{title}</h3>
      <p className={s.stepDesc}>{children}</p>
      <span className={you ? s.stepYou : s.stepWe}>{tag}</span>
    </div>
  );
}

export function Trust() {
  return (
    <section className={`${s.section} ${s.trust}`} id="trust">
      <div className={s.container}>
        <div className={s.sectionHead}>
          <span className={s.eyebrow}>Honest numbers</span>
          <h2 className={s.sectionTitle}>
            We tell you where every
            <br />
            number <em>comes from.</em>
          </h2>
          <p className={s.sectionLead}>
            Two kinds of restaurants, two kinds of data. Fitsy labels both so
            you never mistake an estimate for a fact.
          </p>
        </div>
        <div className={s.trustGrid}>
          <div className={s.trustCard}>
            <span className={`${s.eyebrow} ${s.verified}`}>Verified</span>
            <h3>Chain restaurants</h3>
            <p>
              Published nutrition straight from the restaurant. Exact macros,
              exact calories.
            </p>
            <div className={s.ex}>
              <b>Seed Bowl Co</b>
              <span>Grilled Chicken Bowl</span>
              <span className={s.m}>P 42g · C 48g · F 14g</span>
            </div>
          </div>
          <div className={s.trustCard}>
            <span className={`${s.eyebrow} ${s.ai}`}>AI estimated</span>
            <h3>Local restaurants</h3>
            <p>
              AI-analyzed menus for the mom-and-pop spots that never publish
              nutrition. Approximate, clearly marked, not medical advice.
            </p>
            <div className={s.ex}>
              <b>Northern Cafe</b>
              <span>Braised Beef Rib Noodle Soup</span>
              <span className={s.m}>~P 32g · C 69g · F 21g</span>
            </div>
          </div>
        </div>
        <p className={s.trustNote}>
          No false precision. Low-confidence estimates are rounded, never
          dressed up as exact.
        </p>
      </div>
    </section>
  );
}

/** "3-day free trial, then $7.99 a month or $39.99 a year." Omits the trial clause when there is none. */
function priceAnswer(p: DisplayPricing): string {
  const plans = `${p.monthly} a month or ${p.annual} a year`;
  if (p.trialDays > 0) {
    return `${p.trialDays}-day free trial, then ${plans}. Cancel anytime. Nothing is charged until the trial ends.`;
  }
  return `${plans}. Cancel anytime.`;
}

function faqItems(pricing: DisplayPricing): Array<{ q: string; a: string }> {
  return [
    {
      q: "Where does Fitsy work right now?",
      a: "Los Angeles: Silver Lake, Echo Park, Los Feliz, Hollywood, West Hollywood, Koreatown, Downtown, Mid-City, Studio City, and Venice. Every restaurant with a delivery menu in those neighborhoods is covered. More neighborhoods and cities are on the feedback board. Upvote yours.",
    },
    {
      q: "How accurate are the macros?",
      a: "Chains use published nutrition, so those numbers are exact. Independent restaurants are AI-estimated from the menu and marked as such. Treat them as a close guide, not a lab result.",
    },
    {
      q: "Do I have to log anything?",
      a: "No. Fitsy is not a food diary. You set targets once, and the app ranks what is around you. If you already track in another app, Fitsy just makes the ordering decision easier.",
    },
    {
      q: "What does it cost?",
      a: priceAnswer(pricing),
    },
  ];
}

export function Faq({ pricing }: { pricing: DisplayPricing }) {
  return (
    <section className={s.section} id="faq">
      <div className={s.container}>
        <div className={`${s.sectionHead} ${s.center}`}>
          <span className={s.eyebrow}>FAQ</span>
          <h2 className={s.sectionTitle}>
            Questions, <em>answered.</em>
          </h2>
        </div>
        <div className={s.faq}>
          {faqItems(pricing).map((item, i) => (
            <details key={item.q} open={i === 0}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Closing CTA. Anchored as #waitlist: every "Join the waitlist" link on the
 * site (stats splash, footer, restaurant pages) lands here. At App Store
 * launch this becomes the store badge again (see lib/appLinks.ts).
 */
export function Closing() {
  return (
    <section className={s.closing} id="waitlist">
      <div className={s.container}>
        <span className={s.eyebrow}>
          Launching <time dateTime={LAUNCH_DATE_ISO}>{LAUNCH_DATE_LABEL}</time>
        </span>
        <h2 className={`${s.sectionTitle} ${s.closingTitle}`}>
          Eat out.
          <br />
          <em>Stay on plan.</em>
        </h2>
        <p className={s.sectionLead}>
          Fitsy opens in {LAUNCH_CITY} on {LAUNCH_DATE_LABEL}. Join the
          waitlist to be first in. More cities follow.
        </p>
        <div className={s.closingCtas}>
          <WaitlistForm align="center" />
        </div>
        <p className={s.closingFine}>
          iPhone first. Android coming later.
        </p>
      </div>
    </section>
  );
}

export function FooterCols({ waitlistHref }: { waitlistHref: string }) {
  return (
    <footer className={s.footerCols}>
      <div className={s.footerColsInner}>
        <div>
          <span className={s.footerLogo}>
            fitsy<span className={s.logoDot}>.</span>
          </span>
          <p className={s.footerTag}>
            Find food that fits your macros. Launching in {LAUNCH_CITY} on{" "}
            {LAUNCH_DATE_LABEL}.
          </p>
        </div>
        <div className={s.footerCol}>
          <h4>Product</h4>
          <a href={waitlistHref}>Join the waitlist</a>
          <a href="/restaurants">Browse restaurants</a>
        </div>
        <div className={s.footerCol}>
          <h4>Company</h4>
          <a href="/support">Support</a>
        </div>
        <div className={s.footerCol}>
          <h4>Legal</h4>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Use</a>
        </div>
      </div>
      <div className={s.footerBottom}>
        <span>&copy; {new Date().getFullYear()} Fitsy</span>
        <span>Macros are estimates. Not medical advice.</span>
      </div>
    </footer>
  );
}
