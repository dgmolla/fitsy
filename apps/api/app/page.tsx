import styles from "./landing.module.css";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/restaurantService";
import { APP_STORE_URL } from "@/lib/appLinks";
import { getDisplayPricing } from "@/lib/pricing";
import { Nav } from "@/components/Nav";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { AppleIcon } from "@/components/AppleIcon";
import {
  Closing,
  Faq,
  FooterCols,
  HowItWorks,
  Trust,
} from "@/components/landing/Sections";

// Prisma calls below need runtime env — opt out of build-time prerender.
export const dynamic = "force-dynamic";

const HOME_NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

// The page stays force-dynamic (runtime env for Prisma), but the two COUNT
// scans over ~676k rows do not need to run per request. One hour matches the
// Cache-Control on /api/restaurants/stats.
const getCounts = unstable_cache(
  async () => {
    const [restaurantCount, menuItemCount] = await Promise.all([
      prisma.restaurant.count(),
      prisma.menuItem.count(),
    ]);
    return { restaurantCount, menuItemCount };
  },
  ["landing-counts"],
  { revalidate: 3600 },
);

export default async function LandingPage() {
  const [{ restaurantCount, menuItemCount }, pricing] = await Promise.all([
    getCounts(),
    getDisplayPricing(),
  ]);

  return (
    <main className={styles.page}>
      <Nav links={HOME_NAV_LINKS} />

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
              protein, carb, and fat targets. Eat out without blowing your plan.
            </p>
            <div className={styles.heroCtas}>
              <a href={APP_STORE_URL} className={styles.ctaPrimary}>
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

      {/* ─── Feature grid ────────────────────────────────────────── */}
      <FeatureGrid />

      {/* ─── How it works ────────────────────────────────────────── */}
      <HowItWorks />

      {/* ─── Data honesty ────────────────────────────────────────── */}
      <Trust />

      {/* ─── Stats Splash ────────────────────────────────────────── */}
      <section className={styles.stats} id="stats">
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
          <span className={styles.statLabel}>
            Dishes with macro data in Los Angeles
          </span>
          <span className={styles.statSub}>
            across {restaurantCount.toLocaleString()} local restaurants
          </span>
          <a href={APP_STORE_URL} className={styles.statCta}>
            Find Food For Me
          </a>
        </div>
      </section>

      {/* ─── FAQ + closing CTA ───────────────────────────────────── */}
      <Faq pricing={pricing} />
      <Closing href={APP_STORE_URL} />

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <FooterCols downloadHref={APP_STORE_URL} />
    </main>
  );
}

/* ─── Phone Mockup (pure CSS) ──────────────────────────────────────── */

function PhoneMockup() {
  return (
    <div className={styles.phone}>
      <div className={styles.phoneDynamic} />
      <div className={styles.phoneScreen}>
        <img
          src="/app-screenshot.png"
          alt="Fitsy app search screen"
          className={styles.phoneImg}
        />
      </div>
    </div>
  );
}
