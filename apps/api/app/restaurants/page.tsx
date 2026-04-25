import type { Metadata } from "next";
import styles from "./restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import { slugify, priceSymbol, formatTag } from "@/lib/seoUtils";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Restaurants with Macro Data | Fitsy",
  description:
    "Browse restaurants in Los Angeles with detailed macro data for every menu item. Find high-protein, low-carb, and macro-friendly meals near you.",
  openGraph: {
    title: "Restaurants with Macro Data | Fitsy",
    description:
      "Browse restaurants in Los Angeles with detailed macro data for every menu item.",
    type: "website",
  },
};

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

type RestaurantCard = Awaited<ReturnType<typeof loadRestaurants>>[number];

// Cap matches Vercel's 19 MB ISR fallback limit — full catalog renders to
// ~28 MB. Followup: add pagination / search rather than rendering all rows.
const MAX_RESTAURANTS_PER_PAGE = 500;

async function loadRestaurants() {
  return prisma.restaurant.findMany({
    orderBy: [{ rating: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { menuItems: true } },
    },
    take: MAX_RESTAURANTS_PER_PAGE,
  });
}

export default async function RestaurantsPage() {
  let restaurants: RestaurantCard[] = [];
  try {
    restaurants = await loadRestaurants();
  } catch {
    // DB unreachable at build time — render empty shell, ISR will repopulate
  }

  return (
    <div className={styles.page}>
      <Nav />

      <section className={styles.hero}>
        <span className={styles.heroEyebrow}>Los Angeles · {restaurants.length} restaurants</span>
        <h1 className={styles.heroTitle}>
          Find restaurants that fit{" "}
          <em className={styles.heroEm}>your macros</em>
        </h1>
        <p className={styles.heroSub}>
          Every restaurant below has full macro data for its entire menu —
          protein, carbs, fat, and calories for each dish. Stop guessing, start
          eating out with confidence.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>All Restaurants</h2>
        <div className={styles.grid}>
          {restaurants.map((r) => {
            const slug = slugify(r.name);
            const price = priceSymbol(r.priceLevel);
            return (
              <a
                key={r.id}
                href={`/restaurants/${slug}`}
                className={styles.card}
              >
                {r.photoUrl ? (
                  <img
                    src={r.photoUrl}
                    alt={`${r.name} restaurant`}
                    className={styles.cardPhoto}
                  />
                ) : (
                  <div className={styles.cardPhotoPlaceholder}>🍽️</div>
                )}
                <div className={styles.cardBody}>
                  <div className={styles.cardName}>{r.name}</div>
                  <div className={styles.cardMeta}>
                    {r.rating != null && (
                      <span className={styles.cardRating}>
                        ★ {r.rating.toFixed(1)}
                        {r.userRatingCount != null && (
                          <span style={{ fontWeight: 400 }}>
                            {" "}({r.userRatingCount.toLocaleString()})
                          </span>
                        )}
                      </span>
                    )}
                    {price && <span>{price}</span>}
                    {r.chainFlag && <span>Chain</span>}
                  </div>
                  <div className={styles.cardAddress}>{r.address}</div>
                  {r.cuisineTags.length > 0 && (
                    <div className={styles.tagRow}>
                      {r.cuisineTags.slice(0, 3).map((t) => (
                        <span key={t} className={styles.tag}>
                          {formatTag(t)}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.dietaryOptions.length > 0 && (
                    <div className={styles.tagRow}>
                      {r.dietaryOptions.slice(0, 3).map((t) => (
                        <span key={t} className={`${styles.tag} ${styles.tagGreen}`}>
                          {formatTag(t)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.cardFooter}>
                  <span>
                    <span className={styles.cardItemCount}>
                      {r._count.menuItems}
                    </span>{" "}
                    dishes with macro data
                  </span>
                  <span>View menu →</span>
                </div>
              </a>
            );
          })}
        </div>
      </section>

      <CtaBanner />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo}>
          fitsy<span className={styles.logoDot}>.</span>
        </a>
        <a href={EARLY_ACCESS_URL} className={styles.navCta}>
          Get Early Access
        </a>
      </div>
    </nav>
  );
}

function CtaBanner() {
  return (
    <div className={styles.section} style={{ paddingTop: 0, paddingBottom: 40 }}>
      <div className={styles.ctaBanner}>
        <div className={styles.ctaBannerText}>
          <h3>Track macros at any restaurant</h3>
          <p>Set your protein, carb, and fat targets. Fitsy finds meals that match.</p>
        </div>
        <a href={EARLY_ACCESS_URL} className={styles.ctaButton}>
          Download Fitsy
        </a>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className={styles.footerLogo}>
          fitsy<span className={styles.logoDot}>.</span>
        </span>
        <span>&copy; {new Date().getFullYear()} Fitsy · Los Angeles</span>
      </div>
    </footer>
  );
}
