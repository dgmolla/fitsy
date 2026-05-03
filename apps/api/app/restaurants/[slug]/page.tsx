import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import styles from "../restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import {
  slugify,
  slugWithId,
  parseSlugId,
  calcCalories,
  priceSymbol,
  formatTag,
} from "@/lib/seoUtils";
import { Nav } from "@/components/Nav";

export const revalidate = 86400;

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

// ─── Static params ────────────────────────────────────────────────────────────

// Pages render on first request via ISR (cached per `revalidate`). We don't
// pre-render at build because the catalog has thousands of restaurants and
// fanning out at build time exhausts the Supabase connection pool.
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
  const restaurant = await getRestaurantById(slug);
  if (!restaurant) return {};
  const canonical = `/restaurants/${slugWithId(restaurant.name, restaurant.id)}`;
  return {
    title: `${restaurant.name} Macros & Menu | Fitsy`,
    description: `Full macro breakdown for every menu item at ${restaurant.name}. Find protein, carbs, fat, and calories for each dish — powered by Fitsy.`,
    alternates: { canonical },
    openGraph: {
      title: `${restaurant.name} — Macro-Friendly Menu`,
      description: `Browse the full menu at ${restaurant.name} with macros for every item.`,
      images: restaurant.photoUrl ? [restaurant.photoUrl] : [],
    },
  };
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getRestaurantById(slugParam: string) {
  const parsed = parseSlugId(slugParam);
  if (!parsed) return null;
  return prisma.restaurant.findUnique({
    where: { id: parsed.id },
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
  const parsed = parseSlugId(slug);
  if (!parsed) notFound();
  const restaurant = await getRestaurantById(slug);
  if (!restaurant) notFound();

  // 301 to canonical slug if the human-readable part is stale (e.g. restaurant
  // was renamed). Keeps inbound links working while consolidating SEO weight.
  const canonical = slugWithId(restaurant.name, restaurant.id);
  if (parsed.slug !== slugify(restaurant.name)) {
    redirect(`/restaurants/${canonical}`);
  }

  // Group menu items by category — kept for the Schema.org payload below
  // (search engines benefit from MenuSection / hasMenuItem nesting).
  const byCategory = new Map<string, typeof restaurant.menuItems>();
  for (const item of restaurant.menuItems) {
    const cat = item.category ?? "Menu";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  // Editorial layout: a single grid of items sorted by protein, descending.
  // Items without macro estimates fall to the back.
  const sortedItems = [...restaurant.menuItems].sort((a, b) => {
    const ap = a.macroEstimates[0]?.proteinG ?? -1;
    const bp = b.macroEstimates[0]?.proteinG ?? -1;
    return bp - ap;
  });

  // Aggregate stats for the meta column.
  const itemsWithMacros = restaurant.menuItems.filter((i) => i.macroEstimates.length > 0);
  const avgKcal = itemsWithMacros.length
    ? Math.round(
        itemsWithMacros.reduce((sum, i) => {
          const m = i.macroEstimates[0]!;
          return sum + (m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG));
        }, 0) / itemsWithMacros.length,
      )
    : null;
  const avgProtein = itemsWithMacros.length
    ? Math.round(itemsWithMacros.reduce((sum, i) => sum + i.macroEstimates[0]!.proteinG, 0) / itemsWithMacros.length)
    : null;

  // Title: italicize the last word in green, like the mockup's wordplay
  // ("Sweet[em]green[/em]"). For one-word names, italicize the whole thing.
  const nameWords = restaurant.name.trim().split(/\s+/);
  const titleHead = nameWords.length > 1 ? nameWords.slice(0, -1).join(" ") + " " : "";
  const titleTail = nameWords[nameWords.length - 1] ?? restaurant.name;

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

  const eyebrowParts: string[] = [];
  if (restaurant.cuisineTags.length > 0) {
    eyebrowParts.push(restaurant.cuisineTags.slice(0, 2).map(formatTag).join(" & "));
  }
  eyebrowParts.push(restaurant.chainFlag ? "Chain" : "Independent");
  if (restaurant.menuItems.length > 0) {
    eyebrowParts.push(`${restaurant.menuItems.length} items on the menu`);
  }

  return (
    <div className={`${styles.page} ${styles.editorial}`}>
      <Nav />

      {/* Hero — eyebrow + display title with last-word italic accent + meta column */}
      <header className={styles.editorialHero}>
        <div>
          <div className={styles.editorialEyebrow}>{eyebrowParts.join(" · ")}</div>
          <h1 className={styles.editorialTitle}>
            {titleHead}
            <em>{titleTail}</em>
          </h1>
        </div>
        <div className={styles.editorialMeta}>
          <div className={styles.editorialMetaRow}>
            <span className={styles.editorialMetaLabel}>Address</span>
            <span className={styles.editorialMetaVal}>{restaurant.address}</span>
          </div>
          {restaurant.cuisineTags.length > 0 && (
            <div className={styles.editorialMetaRow}>
              <span className={styles.editorialMetaLabel}>Cuisine</span>
              <span className={styles.editorialMetaVal}>
                {restaurant.cuisineTags.map(formatTag).join(", ")}
              </span>
            </div>
          )}
          {(avgKcal != null || avgProtein != null) && (
            <div className={styles.editorialMetaRow}>
              <span className={styles.editorialMetaLabel}>Avg macros</span>
              <span className={styles.editorialMetaVal}>
                {avgKcal != null && `${avgKcal} kcal`}
                {avgKcal != null && avgProtein != null && " · "}
                {avgProtein != null && `${avgProtein}g protein`}
              </span>
            </div>
          )}
          {restaurant.rating != null && (
            <div className={styles.editorialMetaRow}>
              <span className={styles.editorialMetaLabel}>Rating</span>
              <span className={styles.editorialMetaVal}>
                ★ {restaurant.rating.toFixed(1)}
                {restaurant.userRatingCount != null && (
                  <span style={{ color: "var(--ed-ink-soft)", fontSize: 14, marginLeft: 8 }}>
                    ({restaurant.userRatingCount.toLocaleString()} reviews)
                  </span>
                )}
                {price && (
                  <span style={{ color: "var(--ed-ink-soft)", fontSize: 14, marginLeft: 12 }}>
                    {price}
                  </span>
                )}
              </span>
            </div>
          )}
          {restaurant.dietaryOptions.length > 0 && (
            <div className={styles.editorialMetaRow}>
              <span className={styles.editorialMetaLabel}>Dietary</span>
              <span className={styles.editorialMetaVal}>
                {restaurant.dietaryOptions.map(formatTag).join(", ")}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className={styles.editorialRule} />

      {/* Menu — single grid sorted by protein, mockup-faithful */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>The full menu</h2>
          <span className={styles.sectionMeta}>
            {restaurant.menuItems.length}{" "}
            {restaurant.menuItems.length === 1 ? "item" : "items"}
          </span>
        </div>
        <div className={styles.menuGrid}>
          {sortedItems.map((item, idx) => {
            const m = item.macroEstimates[0];
            const itemHref = `/restaurants/${canonical}/${slugWithId(item.name, item.id)}`;
            const kcal = m
              ? Math.round(m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG))
              : null;
            return (
              <a key={item.id} href={itemHref} className={styles.menuCard}>
                <span className={styles.menuCardNum}>
                  № {String(idx + 1).padStart(2, "0")}
                </span>
                {item.category && (
                  <div className={styles.menuCardCat}>{item.category}</div>
                )}
                <h3 className={styles.menuItemName}>{item.name}</h3>
                {item.description && (
                  <p className={styles.menuItemDesc}>{item.description}</p>
                )}
                {item.dietaryTags.length > 0 && (
                  <div className={styles.tagRow}>
                    {item.dietaryTags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className={`${styles.tag} ${styles.tagGreen}`}
                      >
                        {formatTag(t)}
                      </span>
                    ))}
                  </div>
                )}
                {m && (
                  <div className={styles.menuCardFoot}>
                    <div className={styles.macroStrip}>
                      <div className={`${styles.macro} ${styles.macroCalories}`}>
                        <span className={styles.macroValue}>{kcal}</span>
                        <span className={styles.macroUnit}>Cal</span>
                      </div>
                      <div className={`${styles.macro} ${styles.macroProtein}`}>
                        <span className={styles.macroValue}>
                          {Math.round(m.proteinG)}
                        </span>
                        <span className={styles.macroUnit}>Pro&nbsp;g</span>
                      </div>
                      <div className={`${styles.macro} ${styles.macroCarbs}`}>
                        <span className={styles.macroValue}>
                          {Math.round(m.carbsG)}
                        </span>
                        <span className={styles.macroUnit}>Carb&nbsp;g</span>
                      </div>
                      <div className={`${styles.macro} ${styles.macroFat}`}>
                        <span className={styles.macroValue}>
                          {Math.round(m.fatG)}
                        </span>
                        <span className={styles.macroUnit}>Fat&nbsp;g</span>
                      </div>
                    </div>
                  </div>
                )}
              </a>
            );
          })}
        </div>
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
