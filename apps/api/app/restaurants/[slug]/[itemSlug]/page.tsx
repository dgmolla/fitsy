import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../restaurants.module.css";
import { prisma } from "@/lib/restaurantService";
import {
  slugify,
  calcCalories,
  confidenceLabel,
  formatTag,
} from "@/lib/seoUtils";

export const revalidate = 86400;

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

// ─── Static params ────────────────────────────────────────────────────────────

// Skip pre-rendering at build — same reason as [slug]/page: per-page DB
// fan-out exhausts the connection pool when generating thousands of pages
// in parallel. Pages are still generated on first request and cached per
// `revalidate` (86400s).
export async function generateStaticParams() {
  return [];
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getItemBySlug(slug: string, itemSlug: string) {
  const allRestaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true },
  });
  const restaurant = allRestaurants.find((r) => slugify(r.name) === slug);
  if (!restaurant) return null;

  const allItems = await prisma.menuItem.findMany({
    where: { restaurantId: restaurant.id },
    select: { id: true, name: true },
  });
  const matchItem = allItems.find((i) => slugify(i.name) === itemSlug);
  if (!matchItem) return null;

  const item = await prisma.menuItem.findUnique({
    where: { id: matchItem.id },
    include: { macroEstimates: { orderBy: { id: "desc" }, take: 1 } },
  });
  if (!item) return null;

  return { item, restaurantName: restaurant.name };
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; itemSlug: string }>;
}): Promise<Metadata> {
  const { slug, itemSlug } = await params;
  const data = await getItemBySlug(slug, itemSlug);
  if (!data) return {};

  const { item, restaurantName } = data;
  const m = item.macroEstimates[0];
  const kcal = m
    ? Math.round(m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG))
    : null;

  const macroSummary = m
    ? `${Math.round(m.proteinG)}g protein, ${Math.round(m.carbsG)}g carbs, ${Math.round(m.fatG)}g fat${kcal ? ` (${kcal} cal)` : ""}`
    : "macro data available";

  return {
    title: `${item.name} Macros — ${restaurantName} | Fitsy`,
    description: `The ${item.name} at ${restaurantName} contains ${macroSummary}. Full nutrition breakdown powered by Fitsy.`,
    openGraph: {
      title: `${item.name} — ${restaurantName} Macros`,
      description: `Nutrition breakdown for ${item.name} at ${restaurantName}: ${macroSummary}.`,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MenuItemPage({
  params,
}: {
  params: Promise<{ slug: string; itemSlug: string }>;
}) {
  const { slug, itemSlug } = await params;
  const data = await getItemBySlug(slug, itemSlug);
  if (!data) notFound();

  const { item, restaurantName } = data;
  const m = item.macroEstimates[0];
  const kcal = m
    ? Math.round(m.calories ?? calcCalories(m.proteinG, m.carbsG, m.fatG))
    : null;

  const confidence = m ? confidenceLabel(m.confidence) : null;

  // Schema.org structured data
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MenuItem",
    name: item.name,
    ...(item.description && { description: item.description }),
    ...(item.price != null && {
      offers: {
        "@type": "Offer",
        price: item.price.toFixed(2),
        priceCurrency: "USD",
      },
    }),
    ...(m && {
      nutrition: {
        "@type": "NutritionInformation",
        ...(kcal != null && { calories: `${kcal} calories` }),
        proteinContent: `${Math.round(m.proteinG)}g`,
        carbohydrateContent: `${Math.round(m.carbsG)}g`,
        fatContent: `${Math.round(m.fatG)}g`,
      },
    }),
    suitableForDiet: item.dietaryTags
      .map((t) => {
        if (t === "vegetarian") return "https://schema.org/VegetarianDiet";
        if (t === "vegan") return "https://schema.org/VeganDiet";
        if (t === "gluten_free") return "https://schema.org/GlutenFreeDiet";
        if (t === "low_calorie") return "https://schema.org/LowCalorieDiet";
        return null;
      })
      .filter(Boolean),
    menuAddOn: {
      "@type": "Restaurant",
      name: restaurantName,
    },
  };

  const naturalLanguage = m
    ? `The ${item.name} at ${restaurantName} contains ${Math.round(m.proteinG)}g protein, ${Math.round(m.carbsG)}g carbs, and ${Math.round(m.fatG)}g fat${kcal ? ` for approximately ${kcal} calories` : ""}. ${confidence === "High confidence" ? "This data is sourced directly from the restaurant." : "Macros are estimated based on standard nutritional databases."}`
    : null;

  return (
    <div className={styles.page}>
      <Nav />

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span className={styles.breadcrumbSep}>›</span>
        <a href="/restaurants">Restaurants</a>
        <span className={styles.breadcrumbSep}>›</span>
        <a href={`/restaurants/${slug}`}>{restaurantName}</a>
        <span className={styles.breadcrumbSep}>›</span>
        <span>{item.name}</span>
      </nav>

      {/* Item hero */}
      <div className={styles.itemHero}>
        <h1 className={styles.itemName}>{item.name}</h1>
        <p className={styles.itemRestaurant}>
          at <a href={`/restaurants/${slug}`}>{restaurantName}</a>
          {item.category && <> · {item.category}</>}
          {item.price != null && <> · ${item.price.toFixed(2)}</>}
        </p>

        {/* Answer-engine optimized paragraph */}
        {naturalLanguage && (
          <div className={styles.answerCard}>
            <p className={styles.answerText}>{naturalLanguage}</p>
            {confidence && (
              <div style={{ marginTop: 12 }}>
                <span
                  className={`${styles.confidenceBadge} ${
                    confidence === "High confidence"
                      ? styles.confidenceHigh
                      : confidence === "Estimated"
                        ? styles.confidenceMedium
                        : styles.confidenceLow
                  }`}
                >
                  {confidence === "High confidence" && "✓ "}
                  {confidence}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Macro blocks */}
        {m && (
          <div className={styles.macroGrid}>
            <div className={`${styles.macroBlock} ${styles.macroBlockCalories}`}>
              <span className={styles.macroBlockValue} style={{ color: "#3d7a5e" }}>
                {kcal}
              </span>
              <span className={styles.macroBlockUnit}>cal</span>
              <span className={styles.macroBlockLabel}>Calories</span>
            </div>
            <div className={`${styles.macroBlock} ${styles.macroBlockProtein}`}>
              <span className={styles.macroBlockValue} style={{ color: "#2563eb" }}>
                {Math.round(m.proteinG)}
              </span>
              <span className={styles.macroBlockUnit}>g</span>
              <span className={styles.macroBlockLabel}>Protein</span>
            </div>
            <div className={`${styles.macroBlock} ${styles.macroBlockCarbs}`}>
              <span className={styles.macroBlockValue} style={{ color: "#d97706" }}>
                {Math.round(m.carbsG)}
              </span>
              <span className={styles.macroBlockUnit}>g</span>
              <span className={styles.macroBlockLabel}>Carbs</span>
            </div>
            <div className={`${styles.macroBlock} ${styles.macroBlockFat}`}>
              <span className={styles.macroBlockValue} style={{ color: "#9333ea" }}>
                {Math.round(m.fatG)}
              </span>
              <span className={styles.macroBlockUnit}>g</span>
              <span className={styles.macroBlockLabel}>Fat</span>
            </div>
          </div>
        )}

        {item.description && (
          <p style={{ color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
            {item.description}
          </p>
        )}

        {item.dietaryTags.length > 0 && (
          <div className={styles.tagRow} style={{ marginBottom: 24 }}>
            {item.dietaryTags.map((t) => (
              <span key={t} className={`${styles.tag} ${styles.tagGreen}`}>
                {formatTag(t)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* FAQ */}
      <section className={styles.faqSection}>
        <h2 className={styles.faqTitle}>Nutrition FAQs</h2>
        {m && (
          <>
            <FaqItem
              q={`How many calories are in the ${item.name} at ${restaurantName}?`}
              a={`The ${item.name} at ${restaurantName} has approximately ${kcal} calories.`}
            />
            <FaqItem
              q={`How much protein is in the ${item.name} at ${restaurantName}?`}
              a={`The ${item.name} at ${restaurantName} contains ${Math.round(m.proteinG)}g of protein.`}
            />
            <FaqItem
              q={`How many carbs are in the ${item.name} at ${restaurantName}?`}
              a={`The ${item.name} at ${restaurantName} contains ${Math.round(m.carbsG)}g of carbohydrates.`}
            />
            <FaqItem
              q={`How much fat is in the ${item.name} at ${restaurantName}?`}
              a={`The ${item.name} at ${restaurantName} contains ${Math.round(m.fatG)}g of fat.`}
            />
          </>
        )}
        <FaqItem
          q={`Is the ${item.name} good for macro tracking?`}
          a={`The ${item.name} at ${restaurantName} has complete macro data available in the Fitsy app. Download Fitsy to get personalized recommendations based on your protein, carb, and fat targets.`}
        />
      </section>

      <CtaBanner itemName={item.name} restaurantName={restaurantName} />
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

function CtaBanner({
  itemName,
  restaurantName,
}: {
  itemName: string;
  restaurantName: string;
}) {
  return (
    <div className={styles.section} style={{ paddingTop: 0, paddingBottom: 40 }}>
      <div className={styles.ctaBanner}>
        <div className={styles.ctaBannerText}>
          <h3>Track the {itemName} and every other meal</h3>
          <p>
            Fitsy finds dishes at {restaurantName} and 20+ other LA restaurants
            that fit your exact macro targets.
          </p>
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
