import { test, expect } from "@playwright/test";

test("landing page renders hero and CTA", async ({ page }) => {
  await page.goto("/");

  // Hero heading visible
  const heading = page.locator("h1");
  await expect(heading).toBeVisible();
  await expect(heading).toContainText("macros");

  // Primary CTA present and links somewhere
  const cta = page.locator("a").filter({ hasText: /early access|get started/i }).first();
  await expect(cta).toBeVisible();
});

test("landing page has how-it-works section", async ({ page }) => {
  await page.goto("/");

  // Scroll to anchor target
  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await expect(page.locator("#how-it-works")).toBeVisible();
});
