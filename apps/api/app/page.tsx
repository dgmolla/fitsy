import styles from "./landing.module.css";
import { prisma } from "@/lib/restaurantService";
import { Nav } from "@/components/Nav";
import {
  FeatureGrid,
  type FeedbackTilePost,
} from "@/components/landing/FeatureGrid";
import {
  AppleIcon,
  Closing,
  Faq,
  FooterCols,
  HowItWorks,
  Trust,
} from "@/components/landing/Sections";

// Prisma calls below need runtime env — opt out of build-time prerender.
export const dynamic = "force-dynamic";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy"; // placeholder until TestFlight live

const HOME_NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

export default async function LandingPage() {
  const [restaurantCount, menuItemCount, topPosts] = await Promise.all([
    prisma.restaurant.count(),
    prisma.menuItem.count(),
    // Top-voted public board posts feed the Feedback tile so the tile shows
    // what real users are asking for. Falls back to example posts when empty.
    prisma.feedback.findMany({
      where: { status: "published" },
      orderBy: [{ voteCount: "desc" }, { createdAt: "desc" }],
      take: 3,
      select: { message: true, displayName: true, voteCount: true },
    }),
  ]);
  const posts: FeedbackTilePost[] = topPosts;

  return (
    <main className={styles.page}>
      <Nav
        links={HOME_NAV_LINKS}
        cta={{ href: EARLY_ACCESS_URL, label: "Download the app" }}
      />

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

      {/* ─── Feature grid ────────────────────────────────────────── */}
      <FeatureGrid posts={posts} />

      {/* ─── How it works ────────────────────────────────────────── */}
      <HowItWorks />

      {/* ─── Data honesty ────────────────────────────────────────── */}
      <Trust />

      {/* ─── Stats Splash ────────────────────────────────────────── */}
      <section
        className={`${styles.stats} ${styles.statsAfterTrust}`}
        id="stats"
      >
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
          <a href={EARLY_ACCESS_URL} className={styles.statCta}>
            Find Food For Me
          </a>
        </div>
      </section>

      {/* ─── FAQ + closing CTA ───────────────────────────────────── */}
      <Faq />
      <Closing href={EARLY_ACCESS_URL} />

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <FooterCols downloadHref={EARLY_ACCESS_URL} />
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
