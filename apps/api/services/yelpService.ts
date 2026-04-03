/**
 * Yelp Fusion Business Search — image URL lookup
 *
 * Used as a fallback image source in the preload pipeline when Google Places
 * has no photo for a restaurant.
 *
 * Requires: YELP_API_KEY environment variable.
 * Free tier: 500 requests/day (covers full preload run).
 */

interface YelpSearchResponse {
  businesses?: Array<{
    image_url?: string;
  }>;
}

/**
 * Look up a restaurant on Yelp and return its primary image URL, or null if
 * no match / no image / API key not configured.
 */
export async function searchYelpBusiness(
  name: string,
  address: string,
): Promise<string | null> {
  const apiKey = process.env["YELP_API_KEY"];
  if (!apiKey) return null;

  const params = new URLSearchParams({ term: name, location: address, limit: "1" });

  let response: Response;
  try {
    response = await fetch(
      `https://api.yelp.com/v3/businesses/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = (await response.json()) as YelpSearchResponse;
  return data.businesses?.[0]?.image_url ?? null;
}
