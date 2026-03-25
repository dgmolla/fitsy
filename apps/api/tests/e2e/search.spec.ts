import { test, expect } from "@playwright/test";

/**
 * S-49: E2E search → restaurant detail flow
 *
 * Tests the restaurant discovery API lifecycle against the live server:
 *   1. GET /api/restaurants with valid coords → 200 + array (may be empty)
 *   2. GET /api/restaurants with missing params → 400
 *   3. GET /api/restaurants with invalid lat/lng → 400
 *   4. GET /api/restaurants/:id/menu with valid id → 200 or 404
 *   5. GET /api/restaurants/:id/menu with bogus id → 404
 */

// Silver Lake, LA — same coords used in the hardcoded mobile search screen
const TEST_LAT = 34.0868;
const TEST_LNG = -118.2703;

test.describe("Search flow — GET /api/restaurants", () => {
  test("returns 200 with restaurants array for valid coords", async ({
    request,
    page,
  }) => {
    // Navigate to landing page: gives Playwright video meaningful context
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    const res = await request.get("/api/restaurants", {
      params: { lat: String(TEST_LAT), lng: String(TEST_LNG) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("returns 200 with macro-filtered results when targets supplied", async ({
    request,
  }) => {
    const res = await request.get("/api/restaurants", {
      params: {
        lat: String(TEST_LAT),
        lng: String(TEST_LNG),
        protein: "40",
        calories: "600",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("returns 400 when lat is missing", async ({ request }) => {
    const res = await request.get("/api/restaurants", {
      params: { lng: String(TEST_LNG) },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("returns 400 when lng is missing", async ({ request }) => {
    const res = await request.get("/api/restaurants", {
      params: { lat: String(TEST_LAT) },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("returns 400 for invalid lat/lng values", async ({ request }) => {
    const res = await request.get("/api/restaurants", {
      params: { lat: "not-a-number", lng: String(TEST_LNG) },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

test.describe("Restaurant detail flow — GET /api/restaurants/:id/menu", () => {
  test("returns 404 for a bogus restaurant id", async ({ request }) => {
    const res = await request.get(
      "/api/restaurants/bogus-nonexistent-id-xyz/menu",
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("returns 200 or 404 for first restaurant from search (graceful if DB empty)", async ({
    request,
    page,
  }) => {
    // Navigate to landing page: gives Playwright video context
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    const searchRes = await request.get("/api/restaurants", {
      params: { lat: String(TEST_LAT), lng: String(TEST_LNG) },
    });
    expect(searchRes.status()).toBe(200);
    const searchBody = await searchRes.json();
    const restaurants = searchBody.data as Array<{ id: string }>;

    if (!Array.isArray(restaurants) || restaurants.length === 0) {
      // Staging DB is empty — graceful skip
      return;
    }

    // Tap the first restaurant and verify menu endpoint
    const firstId = restaurants[0]!.id;
    const menuRes = await request.get(`/api/restaurants/${firstId}/menu`);
    expect([200, 404]).toContain(menuRes.status());

    if (menuRes.status() === 200) {
      const menu = await menuRes.json();
      expect(menu).toHaveProperty("restaurant");
      expect(menu).toHaveProperty("menuItems");
      expect(Array.isArray(menu.menuItems)).toBe(true);
    }
  });
});
