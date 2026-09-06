import s from "@/app/landing-sections.module.css";

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

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Where does Fitsy work right now?",
    a: "Los Angeles, starting with Silver Lake, Echo Park, and Los Feliz. Every restaurant with a delivery menu in those neighborhoods is covered. More neighborhoods and cities are on the feedback board. Upvote yours.",
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
    a: "Three days free, then $7.99 a month or $39.99 a year. Cancel anytime. Nothing is charged until the trial ends.",
  },
];

export function Faq() {
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
          {FAQ_ITEMS.map((item, i) => (
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

export function Closing({ href }: { href: string }) {
  return (
    <section className={s.closing} id="download">
      <div className={s.container}>
        <span className={s.eyebrow}>Free for 3 days</span>
        <h2 className={`${s.sectionTitle} ${s.closingTitle}`}>
          Eat out.
          <br />
          <em>Stay on plan.</em>
        </h2>
        <p className={s.sectionLead}>
          Join the Los Angeles beta. Cancel anytime, and nothing is charged
          until your trial ends.
        </p>
        <div className={s.closingCtas}>
          <a href={href} className={s.storeBadge}>
            <AppleIcon />
            <span className={s.sb}>
              <small>Download on the</small>
              <b>App Store</b>
            </span>
          </a>
        </div>
        <p className={s.closingFine}>
          Available on iPhone. Android coming soon.
        </p>
      </div>
    </section>
  );
}

export function FooterCols({ downloadHref }: { downloadHref: string }) {
  return (
    <footer className={s.footerCols}>
      <div className={s.footerColsInner}>
        <div className={s.footerBrand}>
          <span className={s.footerLogo}>
            fitsy<span className={s.logoDot}>.</span>
          </span>
          <p className={s.footerTag}>
            Find food that fits your macros. Now in beta in Los Angeles.
          </p>
        </div>
        <div className={s.footerCol}>
          <h4>Product</h4>
          <a href={downloadHref}>Download the app</a>
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

export function AppleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.537 8.426c-.02-1.983 1.619-2.935 1.693-2.98-.921-1.348-2.355-1.532-2.867-1.553-1.22-.124-2.382.719-3.001.719-.618 0-1.574-.7-2.586-.682-1.331.02-2.558.774-3.243 1.966-1.382 2.397-.354 5.95.993 7.896.658.952 1.443 2.021 2.474 1.983.993-.04 1.368-.642 2.568-.642 1.2 0 1.535.642 2.587.622 1.069-.019 1.743-.97 2.397-1.924.756-1.103 1.067-2.171 1.085-2.227-.024-.011-2.082-.799-2.1-3.178zM10.56 2.596c.547-.664.916-1.585.816-2.504-.789.032-1.745.525-2.311 1.189-.508.588-.952 1.527-.833 2.429.881.068 1.78-.448 2.328-1.114z" />
    </svg>
  );
}
