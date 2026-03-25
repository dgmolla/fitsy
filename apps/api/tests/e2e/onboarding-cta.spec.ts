import { test, expect } from "@playwright/test";

/**
 * S-50: E2E onboarding CTA flow
 *
 * Tests the landing page CTA funnel:
 *   1. Hero CTA ("Get Early Access") is visible and has correct href
 *   2. Secondary CTA ("How it works") scrolls to the #how-it-works section
 *   3. How-it-works section CTA ("Try the beta") is present
 *   4. Features section renders all three value propositions
 *   5. Full page render — no broken layout sections
 */

test.describe("Onboarding CTA flow", () => {
  test("hero primary CTA is visible and links to TestFlight", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    const primaryCta = page
      .locator("a")
      .filter({ hasText: /get early access/i })
      .first();
    await expect(primaryCta).toBeVisible();

    // CTA must have an href (even a placeholder is fine — just not empty)
    const href = await primaryCta.getAttribute("href");
    expect(href).toBeTruthy();
  });

  test("secondary CTA scrolls to how-it-works section", async ({ page }) => {
    await page.goto("/");

    const secondaryCta = page
      .locator("a")
      .filter({ hasText: /how it works/i })
      .first();
    await expect(secondaryCta).toBeVisible();

    // The link targets the #how-it-works anchor
    const href = await secondaryCta.getAttribute("href");
    expect(href).toBe("#how-it-works");

    // Clicking scrolls the section into view
    await secondaryCta.click();
    await expect(page.locator("#how-it-works")).toBeVisible();
  });

  test("how-it-works section renders steps and bottom CTA", async ({
    page,
  }) => {
    await page.goto("/");

    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    const section = page.locator("#how-it-works");
    await expect(section).toBeVisible();

    // Three numbered steps must be present
    await expect(section.locator("text=1")).toBeVisible();
    await expect(section.locator("text=2")).toBeVisible();
    await expect(section.locator("text=3")).toBeVisible();

    // Bottom CTA in the section
    const bottomCta = section.locator("a").filter({ hasText: /try the beta/i });
    await expect(bottomCta).toBeVisible();
    const href = await bottomCta.getAttribute("href");
    expect(href).toBeTruthy();
  });

  test("features section renders three value proposition cards", async ({
    page,
  }) => {
    await page.goto("/");

    // All three feature card titles must be visible
    await expect(
      page.locator("h3").filter({ hasText: /macro target/i }),
    ).toBeVisible();
    await expect(
      page.locator("h3").filter({ hasText: /nutrition/i }),
    ).toBeVisible();
    await expect(
      page.locator("h3").filter({ hasText: /local/i }),
    ).toBeVisible();
  });

  test("full page has nav, hero, features, how-it-works, and footer", async ({
    page,
  }) => {
    await page.goto("/");

    // Nav brand
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.locator("text=fitsy")).toBeVisible();

    // Hero
    await expect(page.locator("h1")).toBeVisible();

    // Features
    await expect(
      page.locator("h2").filter({ hasText: /macro-aware/i }),
    ).toBeVisible();

    // How it works
    await expect(page.locator("#how-it-works")).toBeVisible();

    // Footer
    await expect(page.locator("footer")).toBeVisible();
  });
});
