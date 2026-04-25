import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import {
  slugify,
  calcCalories,
  priceSymbol,
  formatTag,
} from "@/lib/seoUtils";

export const revalidate = 86400;

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

// ─── Static params ────────────────────────────────────────────────────────────

// Skip pre-rendering at build — getRestaurantBySlug fires multiple queries
// per page, and 5000+ restaurants × build-time concurrency exhausts the
// Supabase connection pool. Pages are still generated on first request and
// cached per `revalidate` (86400s).
export async function generateStaticParams() {
  return [];
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return {};
  return {
    title: `${restaurant.name} Macros & Menu | Fitsy`,
    description: `Full macro breakdown for every menu item at ${restaurant.name}. Find protein, carbs, fat, and calories for each dish — powered by Fitsy.`,
    openGraph: {
      title: `${restaurant.name} — Macro-Friendly Menu`,
      description: `Browse the full menu at ${restaurant.name} with macros for every item.`,
      images: restaurant.photoUrl ? [restaurant.photoUrl] : [],
    },
  };
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getRestaurantBySlug(slug: string) {
  const all = await prisma.restaurant.findMany({ select: { id: true, name: true } });
  const match = all.find((r) => slugify(r.name) === slug);
  if (!match) return null;
  return prisma.restaurant.findUnique({
    where: { id: match.id },
    include: {
      menuItems: {
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          macroEstimates: { orderBy: { id: "desc" }, take: 1 },
        },
      },
    },
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  // Group menu items by category
  const byCategory = new Map<string, typeof restaurant.menuItems>();
  for (const item of restaurant.menuItems) {
    const cat = item.category ?? "Menu";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  const price = priceSymbol(restaurant.priceLevel);

  // Schema.org structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: restaurant.address,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: restaurant.lat,
      longitude: restaurant.lng,
    },
    ...(restaurant.rating != null && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: restaurant.rating,
        reviewCount: restaurant.userRatingCount ?? 1,
      },
    }),
    ...(restaurant.photoUrl && { image: restaurant.photoUrl }),
    servesCuisine: restaurant.cuisineTags.map(formatTag),
    hasMenu: {
      "@type": "Menu",
      hasMenuSection: Array.from(byCategory.entries()).map(([cat, items]) => ({
        "@type": "MenuSection",
        name: cat,
        hasMenuItem: items
          .filter((i) => i.macroEstimates.length > 0)
          .map((i) => {
            const m = i.macroEstimates[0]!;
            const kcal = m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG);
            return {
              "@type": "MenuItem",
              name: i.name,
              description: i.description ?? undefined,
              nutrition: {
                "@type": "NutritionInformation",
                calories: `${Math.round(kcal)} calories`,
                proteinContent: `${Math.round(m.proteinG)}g`,
                carbohydrateContent: `${Math.round(m.carbsG)}g`,
                fatContent: `${Math.round(m.fatG)}g`,
              },
            };
          }),
      })),
    },
  };

  return (
    <div className={styles.page}>
      <Nav />

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span className={styles.breadcrumbSep}>›</span>
        <a href="/restaurants">Restaurants</a>
        <span className={styles.breadcrumbSep}>›</span>
        <span>{restaurant.name}</span>
      </nav>

      {/* Restaurant header */}
      <header className={styles.restaurantHeader}>
        {restaurant.photoUrl ? (
          <img
            src={restaurant.photoUrl}
            alt={`${restaurant.name} exterior`}
            className={styles.restaurantPhoto}
          />
        ) : (
          <div className={styles.restaurantPhotoPlaceholder}>🍽️</div>
        )}
        <div className={styles.restaurantInfo}>
          <h1 className={styles.restaurantName}>{restaurant.name}</h1>
          <div className={styles.restaurantMeta}>
            {restaurant.rating != null && (
              <span className={styles.ratingBadge}>
                ★ {restaurant.rating.toFixed(1)}
                {restaurant.userRatingCount != null && (
                  <span style={{ fontWeight: 400, marginLeft: 3 }}>
                    ({restaurant.userRatingCount.toLocaleString()} reviews)
                  </span>
                )}
              </span>
            )}
            {price && <span>{price}</span>}
            <span>{restaurant.chainFlag ? "Chain" : "Independent"}</span>
          </div>
          <div>{restaurant.address}</div>
          {restaurant.cuisineTags.length > 0 && (
            <div className={styles.tagRow}>
              {restaurant.cuisineTags.map((t) => (
                <span key={t} className={styles.tag}>{formatTag(t)}</span>
              ))}
            </div>
          )}
          {restaurant.dietaryOptions.length > 0 && (
            <div className={styles.tagRow}>
              {restaurant.dietaryOptions.map((t) => (
                <span key={t} className={`${styles.tag} ${styles.tagGreen}`}>
                  {formatTag(t)}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Menu */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Full Menu with Macros ({restaurant.menuItems.length} items)
        </h2>
        {Array.from(byCategory.entries()).map(([cat, items]) => (
          <div key={cat} className={styles.menuSection}>
            <div className={styles.menuCategory}>{cat}</div>
            <div className={styles.menuGrid}>
              {items.map((item) => {
                const m = item.macroEstimates[0];
                const itemSlug = slugify(item.name);
                const kcal = m
                  ? Math.round(m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG))
                  : null;
                return (
                  <a
                    key={item.id}
                    href={`/restaurants/${slug}/${itemSlug}`}
                    className={styles.menuCard}
                  >
                    <div className={styles.menuItemName}>{item.name}</div>
                    {item.description && (
                      <div className={styles.menuItemDesc}>{item.description}</div>
                    )}
                    {m && (
                      <div className={styles.macroStrip}>
                        <div className={`${styles.macro} ${styles.macroCalories}`}>
                          <span className={styles.macroValue}>{kcal}</span>
                          <span className={styles.macroUnit}>cal</span>
                        </div>
                        <div className={`${styles.macro} ${styles.macroProtein}`}>
                          <span className={styles.macroValue}>{Math.round(m.proteinG)}g</span>
                          <span className={styles.macroUnit}>protein</span>
                        </div>
                        <div className={`${styles.macro} ${styles.macroCarbs}`}>
                          <span className={styles.macroValue}>{Math.round(m.carbsG)}g</span>
                          <span className={styles.macroUnit}>carbs</span>
                        </div>
                        <div className={`${styles.macro} ${styles.macroFat}`}>
                          <span className={styles.macroValue}>{Math.round(m.fatG)}g</span>
                          <span className={styles.macroUnit}>fat</span>
                        </div>
                      </div>
                    )}
                    {item.dietaryTags.length > 0 && (
                      <div className={styles.tagRow}>
                        {item.dietaryTags.slice(0, 3).map((t) => (
                          <span key={t} className={`${styles.tag} ${styles.tagGreen}`}>
                            {formatTag(t)}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* FAQ */}
      <section className={styles.faqSection}>
        <h2 className={styles.faqTitle}>
          Frequently Asked Questions
        </h2>
        <FaqItem
          q={`What are the macros at ${restaurant.name}?`}
          a={`${restaurant.name} has ${restaurant.menuItems.length} menu items with full macro data including protein, carbs, fat, and calories for each dish. Browse the full menu above to find items that fit your nutrition targets.`}
        />
        <FaqItem
          q={`Does ${restaurant.name} have high-protein options?`}
          a={`Yes — use the Fitsy app to filter ${restaurant.name}'s menu by your protein target. You can set your daily macro goals and Fitsy will rank every dish by how well it matches.`}
        />
        {restaurant.dietaryOptions.includes("vegetarian") && (
          <FaqItem
            q={`Does ${restaurant.name} have vegetarian options?`}
            a={`${restaurant.name} has vegetarian menu items. View the menu above and filter by dietary tag to find them.`}
          />
        )}
        <FaqItem
          q={`Is ${restaurant.name} good for macro tracking?`}
          a={`${restaurant.name} is macro-friendly with detailed nutrition data for its entire menu. Download the Fitsy app to get personalized meal recommendations based on your specific protein, carb, and fat targets.`}
        />
      </section>

      <CtaBanner restaurantName={restaurant.name} />
      <Footer />

      {/* Schema.org structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className={styles.faqItem}>
      <div className={styles.faqQ}>{q}</div>
      <div className={styles.faqA}>{a}</div>
    </div>
  );
}

function CtaBanner({ restaurantName }: { restaurantName: string }) {
  return (
    <div className={styles.section} style={{ paddingTop: 0, paddingBottom: 40 }}>
      <div className={styles.ctaBanner}>
        <div className={styles.ctaBannerText}>
          <h3>Find meals at {restaurantName} that fit your macros</h3>
          <p>Set your protein, carb, and fat targets. Fitsy ranks every dish.</p>
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
