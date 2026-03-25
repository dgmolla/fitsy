import styles from "./landing.module.css";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy"; // placeholder until TestFlight live

export default function LandingPage() {
  return (
    <main className={styles.page}>
      {/* ─── Nav ─────────────────────────────────────────────────────── */}
      <nav className={styles.nav}>
        <span className={styles.logo}>fitsy</span>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <span className={styles.badge}>Beta · Silver Lake, LA</span>
        <h1 className={styles.headline}>
          Find food that{" "}
          <span className={styles.headlineAccent}>fits your macros</span>
        </h1>
        <p className={styles.subheadline}>
          Fitsy finds restaurants near you with meals that match your protein,
          carb, and fat targets — so you can eat out without blowing your plan.
        </p>
        <div className={styles.ctaGroup}>
          <a href={EARLY_ACCESS_URL} className={styles.ctaPrimary}>
            🍎 Get Early Access
          </a>
          <a href="#how-it-works" className={styles.ctaSecondary}>
            How it works
          </a>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────────── */}
      <section className={styles.features}>
        <p className={styles.sectionLabel}>Why Fitsy</p>
        <h2 className={styles.sectionTitle}>
          Macro-aware restaurant discovery
        </h2>
        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🎯</div>
            <h3 className={styles.cardTitle}>Search by macro target</h3>
            <p className={styles.cardBody}>
              Set your protein, carb, and fat goals. Fitsy ranks nearby
              restaurants by how well their menu items match — not just by
              rating or cuisine.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🤖</div>
            <h3 className={styles.cardTitle}>AI-estimated nutrition</h3>
            <p className={styles.cardBody}>
              We scrape menus from thousands of local restaurants and use
              Claude AI to estimate macros — even for the mom-and-pop spots
              that have never published nutrition data.
            </p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>📍</div>
            <h3 className={styles.cardTitle}>Local & independent</h3>
            <p className={styles.cardBody}>
              Chain nutrition data is already out there. Fitsy fills the gap
              for independent restaurants — the ones worth eating at that
              don&apos;t have a calorie counter on their website.
            </p>
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────────────── */}
      <section className={styles.how} id="how-it-works">
        <div className={styles.howInner}>
          <p className={styles.howLabel}>How it works</p>
          <h2 className={styles.howTitle}>Three steps to eating on track</h2>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNum}>1</div>
              <p className={styles.stepText}>
                <strong>Set your targets.</strong> Tell Fitsy your macro goals
                — protein first, then carbs and fat. Or pick a preset like Cut,
                Maintain, or Bulk.
              </p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}>2</div>
              <p className={styles.stepText}>
                <strong>Browse nearby matches.</strong> Fitsy shows you
                restaurants ranked by macro fit, with the best-matching meal
                highlighted for each.
              </p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}>3</div>
              <p className={styles.stepText}>
                <strong>Tap to see the full breakdown.</strong> Calories,
                protein, carbs, fat — and an AI confidence score so you know
                how reliable the estimate is.
              </p>
            </div>
          </div>
          <a href={EARLY_ACCESS_URL} className={styles.howCta}>
            🍎 Try the beta
          </a>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        © {new Date().getFullYear()} Fitsy · macro-aware restaurant discovery
      </footer>
    </main>
  );
}
