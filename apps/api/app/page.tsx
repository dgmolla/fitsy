import styles from "./landing.module.css";
import { prisma } from "@/lib/restaurantService";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy"; // placeholder until TestFlight live

export default async function LandingPage() {
  const [restaurantCount, menuItemCount] = await Promise.all([
    prisma.restaurant.count(),
    prisma.menuItem.count(),
  ]);
  return (
    <main className={styles.page}>
      {/* ─── Nav ─────────────────────────────────────────────────── */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <span className={styles.logo}>
            fitsy<span className={styles.logoDot}>.</span>
          </span>
          <a href={EARLY_ACCESS_URL} className={styles.navCta}>
            Get Early Access
          </a>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroText}>
            <span className={styles.badge}>Now in Beta (Los Angeles)</span>
            <h1 className={styles.headline}>
              Find food that fits
              <br />
              <em className={styles.headlineEm}>your macros</em>
            </h1>
            <p className={styles.subtitle}>
              Fitsy finds restaurants near you with meals that match your
              protein, carb, and fat targets — so you can eat out without
              blowing your plan.
            </p>
            <div className={styles.heroCtas}>
              <a href={EARLY_ACCESS_URL} className={styles.ctaPrimary}>
                <AppleIcon />
                Download the App
              </a>
              <a href="#features" className={styles.ctaGhost}>
                Learn more
                <span className={styles.ctaArrow}>&#8595;</span>
              </a>
            </div>
          </div>
          <div className={styles.heroPhone}>
            <PhoneMockup />
          </div>
        </div>
      </section>

      {/* ─── Stats Splash ────────────────────────────────────────── */}
      <section className={styles.stats} id="features">
        <div className={styles.statsWords} aria-hidden="true">
          <span>High Protein</span>
          <span>Low Carb</span>
          <span>Keto</span>
          <span className={styles.statsWordActive}>Macro Friendly</span>
          <span>Low Fat</span>
          <span>Balanced</span>
          <span>High Fiber</span>
          <span>Bulking</span>
          <span>Cutting</span>
        </div>
        <div className={styles.statsContent}>
          <span className={styles.statNumber}>
            {menuItemCount.toLocaleString()}
          </span>
          <span className={styles.statLabel}>Dishes with macro data in Los Angeles</span>
          <span className={styles.statSub}>
            across {restaurantCount.toLocaleString()} local restaurants
          </span>
          <a href={EARLY_ACCESS_URL} className={styles.statCta}>
            Find Food For Me
          </a>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span className={styles.footerLogo}>
            fitsy<span className={styles.logoDot}>.</span>
          </span>
          <span className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Fitsy
          </span>
        </div>
      </footer>
    </main>
  );
}

/* ─── Phone Mockup (pure CSS) ──────────────────────────────────────── */

function PhoneMockup() {
  return (
    <div className={styles.phone}>
      <div className={styles.phoneDynamic} />
      <div className={styles.phoneScreen}>
        {/* App header */}
        <div className={styles.appHeader}>
          <span className={styles.appLogo}>
            fitsy<span className={styles.appLogoDot}>.</span>
          </span>
          <span className={styles.appLocation}>Silver Lake</span>
        </div>

        {/* Macro strip */}
        <div className={styles.appMacroStrip}>
          <div className={styles.appMacro}>
            <span className={`${styles.appMacroDot} ${styles.dotProtein}`} />
            <span className={styles.appMacroLabel}>P</span>
            <span className={styles.appMacroVal}>45g</span>
          </div>
          <div className={styles.appMacro}>
            <span className={`${styles.appMacroDot} ${styles.dotCarbs}`} />
            <span className={styles.appMacroLabel}>C</span>
            <span className={styles.appMacroVal}>50g</span>
          </div>
          <div className={styles.appMacro}>
            <span className={`${styles.appMacroDot} ${styles.dotFat}`} />
            <span className={styles.appMacroLabel}>F</span>
            <span className={styles.appMacroVal}>20g</span>
          </div>
          <span className={styles.appMacroEdit}>Edit</span>
        </div>

        {/* Cuisine chips */}
        <div className={styles.appChips}>
          <span className={`${styles.appChip} ${styles.appChipActive}`}>
            All
          </span>
          <span className={styles.appChip}>Asian</span>
          <span className={styles.appChip}>Mexican</span>
          <span className={styles.appChip}>Healthy</span>
        </div>

        {/* Hero restaurant card */}
        <div className={styles.appCard}>
          <div className={styles.appCardOverlay}>
            <span className={styles.appCardIdx}>#01</span>
            <span className={styles.appCardName}>Botanica</span>
            <span className={styles.appCardMeta}>0.3 mi &middot; $$</span>
            <div className={styles.appCardDivider} />
            <span className={styles.appCardDish}>Grilled Chicken Bowl</span>
            <span className={styles.appCardMacros}>
              P 42g &middot; C 35g &middot; F 12g
            </span>
          </div>
        </div>

        {/* Peeking second card */}
        <div className={styles.appCardPeek}>
          <span className={styles.appPeekIdx}>#02</span>
          <span className={styles.appPeekName}>Sqirl</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline SVG Icons ─────────────────────────────────────────────── */

function AppleIcon() {
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

