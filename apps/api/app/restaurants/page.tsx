import type { Metadata } from "next";
import styles from "./restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import { slugWithId, priceSymbol, formatTag } from "@/lib/seoUtils";

export const revalidate = 86400;

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";
const PAGE_SIZE = 20;

type RestaurantCard = Awaited<ReturnType<typeof loadRestaurants>>["rows"][number];

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function loadRestaurants(page: number) {
  const [rows, total] = await Promise.all([
    prisma.restaurant.findMany({
      orderBy: [{ rating: "desc" }, { name: "asc" }],
      include: { _count: { select: { menuItems: true } } },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.restaurant.count(),
  ]);
  return { rows, total };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}): Promise<Metadata> {
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const canonical = page === 1 ? "/restaurants" : `/restaurants?page=${page}`;
  const title =
    page === 1
      ? "Restaurants with Macro Data | Fitsy"
      : `Restaurants with Macro Data — Page ${page} | Fitsy`;
  return {
    title,
    description:
      "Browse restaurants in Los Angeles with detailed macro data for every menu item. Find high-protein, low-carb, and macro-friendly meals near you.",
    alternates: { canonical },
    openGraph: {
      title,
      description:
        "Browse restaurants in Los Angeles with detailed macro data for every menu item.",
      type: "website",
    },
  };
}

export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);

  let rows: RestaurantCard[] = [];
  let total = 0;
  try {
    const data = await loadRestaurants(page);
    rows = data.rows;
    total = data.total;
  } catch {
    // DB unreachable at build time — render empty shell, ISR will repopulate
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const pageHref = (n: number) => (n === 1 ? "/restaurants" : `/restaurants?page=${n}`);

  return (
    <div className={styles.page}>
      <Nav />

      <section className={styles.hero}>
        <span className={styles.heroEyebrow}>
          Los Angeles · {total.toLocaleString()} restaurants{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
        </span>
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
          {rows.map((r) => {
            const href = `/restaurants/${slugWithId(r.name, r.id)}`;
            const price = priceSymbol(r.priceLevel);
            return (
              <a
                key={r.id}
                href={href}
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

        {totalPages > 1 && (
          <nav className={styles.pagination} aria-label="Pagination">
            {hasPrev ? (
              <a href={pageHref(page - 1)} rel="prev" className={styles.paginationLink}>
                ← Previous
              </a>
            ) : (
              <span className={`${styles.paginationLink} ${styles.paginationDisabled}`}>← Previous</span>
            )}
            <span className={styles.paginationStatus}>
              Page {page} of {totalPages}
            </span>
            {hasNext ? (
              <a href={pageHref(page + 1)} rel="next" className={styles.paginationLink}>
                Next →
              </a>
            ) : (
              <span className={`${styles.paginationLink} ${styles.paginationDisabled}`}>Next →</span>
            )}
          </nav>
        )}
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
