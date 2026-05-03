import type { Metadata } from "next";
import styles from "./restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import { slugWithId, priceSymbol, formatTag } from "@/lib/seoUtils";
import { Nav } from "@/components/Nav";

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
    <div className={`${styles.page} ${styles.editorial} ${styles.directory}`}>
      <Nav />

      {/* Compact directory header — small italic title, no display-size hero */}
      <header className={styles.dirHeader}>
        <div className={styles.dirEyebrow}>
          Fitsy &middot; The directory &middot; {total.toLocaleString()} restaurants
          {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
        </div>
        <h1 className={styles.dirTitle}>
          Los Angeles, <em>eaten well.</em>
        </h1>
        <p className={styles.dirSub}>
          Every place on this list has full macro data for its entire menu —
          protein, carbs, fat, calories per dish. Pick one and dig in.
        </p>
      </header>

      <div className={styles.dirToolbar}>
        <div className={styles.dirCount}>
          <span className={styles.dirCountNum}>
            {total.toLocaleString()}
          </span>{" "}
          <span className={styles.dirCountLabel}>restaurants in Los Angeles</span>
        </div>
        <div className={styles.dirSort}>
          <span className={styles.dirSortLabel}>Sorted by</span>{" "}
          <em>★ rating</em>
        </div>
      </div>

      <ol className={styles.dirList}>
        {rows.map((r, idx) => {
          const href = `/restaurants/${slugWithId(r.name, r.id)}`;
          const price = priceSymbol(r.priceLevel);
          const num = (page - 1) * PAGE_SIZE + idx + 1;
          const tagBits: string[] = [];
          if (r.cuisineTags.length > 0)
            tagBits.push(r.cuisineTags.slice(0, 2).map(formatTag).join(", "));
          tagBits.push(r.chainFlag ? "Chain" : "Independent");
          if (price) tagBits.push(price);
          if (r.dietaryOptions.length > 0)
            tagBits.push(r.dietaryOptions.slice(0, 2).map(formatTag).join(", "));
          return (
            <li key={r.id} className={styles.dirRow}>
              <a href={href} className={styles.dirRowLink}>
                <span className={styles.dirNum}>
                  № {String(num).padStart(2, "0")}
                </span>
                {r.photoUrl ? (
                  <img
                    src={r.photoUrl}
                    alt={`${r.name} photo`}
                    className={styles.dirThumb}
                  />
                ) : (
                  <span className={styles.dirThumbPlaceholder} aria-hidden>
                    {r.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className={styles.dirInfo}>
                  <h3 className={styles.dirName}>{r.name}</h3>
                  {r.address && (
                    <div className={styles.dirAddress}>{r.address}</div>
                  )}
                  <div className={styles.dirTags}>
                    {tagBits.map((bit, i) => (
                      <span key={i} className={styles.dirTagBit}>
                        {bit}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.dirStats}>
                  {r.rating != null && (
                    <span className={styles.dirRating}>
                      ★ {r.rating.toFixed(1)}
                    </span>
                  )}
                  <span className={styles.dirDishes}>
                    <em>{r._count.menuItems}</em> dishes
                  </span>
                  <span className={styles.dirArrow}>View menu →</span>
                </div>
              </a>
            </li>
          );
        })}
      </ol>

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Pagination">
          {hasPrev ? (
            <a
              href={pageHref(page - 1)}
              rel="prev"
              className={styles.paginationLink}
            >
              ← Previous
            </a>
          ) : (
            <span
              className={`${styles.paginationLink} ${styles.paginationDisabled}`}
            >
              ← Previous
            </span>
          )}
          <span className={styles.paginationStatus}>
            Page {page} of {totalPages}
          </span>
          {hasNext ? (
            <a
              href={pageHref(page + 1)}
              rel="next"
              className={styles.paginationLink}
            >
              Next →
            </a>
          ) : (
            <span
              className={`${styles.paginationLink} ${styles.paginationDisabled}`}
            >
              Next →
            </span>
          )}
        </nav>
      )}

      <CtaBanner />
      <Footer />
    </div>
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
