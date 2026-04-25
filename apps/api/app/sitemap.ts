import type { MetadataRoute } from "next";
import { prisma } from "@/lib/restaurantService";
import { slugWithId } from "@/lib/seoUtils";

export const revalidate = 86400;

const BASE_URL = "https://fitsy.app";

// Sitemap caps. Vercel's per-page ISR fallback limit is ~19 MB, and the
// sitemap.xml protocol caps each file at 50k URLs / 50 MB. Followup:
// migrate to a sitemap index (`generateSitemaps` + sharded `sitemap()`)
// once the catalog grows past these caps in earnest.
const MAX_RESTAURANTS = 1000;
const MAX_ITEMS_PER_RESTAURANT = 20;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let restaurants: {
    id: string;
    name: string;
    updatedAt: Date;
    menuItems: { id: string; name: string; updatedAt: Date }[];
  }[] = [];
  try {
    restaurants = await prisma.restaurant.findMany({
      select: {
        id: true,
        name: true,
        updatedAt: true,
        menuItems: {
          select: { id: true, name: true, updatedAt: true },
          take: MAX_ITEMS_PER_RESTAURANT,
        },
      },
      orderBy: [{ rating: "desc" }, { name: "asc" }],
      take: MAX_RESTAURANTS,
    });
  } catch {
    // DB unreachable at build time — emit static routes only
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/restaurants`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  const restaurantRoutes: MetadataRoute.Sitemap = restaurants.map((r) => ({
    url: `${BASE_URL}/restaurants/${slugWithId(r.name, r.id)}`,
    lastModified: r.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const itemRoutes: MetadataRoute.Sitemap = restaurants.flatMap((r) =>
    r.menuItems.map((item) => ({
      url: `${BASE_URL}/restaurants/${slugWithId(r.name, r.id)}/${slugWithId(item.name, item.id)}`,
      lastModified: item.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  );

  return [...staticRoutes, ...restaurantRoutes, ...itemRoutes];
}
