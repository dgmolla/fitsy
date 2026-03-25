import { test, expect } from "@playwright/test";

/**
 * S-48: E2E auth flow — register + login
 *
 * Tests the auth API lifecycle against the live server:
 *   1. Register a new user → 201 + JWT
 *   2. Login with same credentials → 200 + JWT
 *   3. Login with wrong password → 401
 *   4. Register duplicate email → 409
 */

const TEST_PASSWORD = "E2ePassword1!";
const TEST_NAME = "E2E Auth User";

test.describe("Auth flow — register", () => {
  test("registers a new user and returns 201 with token", async ({ request, page }) => {
    // Navigate to landing page first: gives Playwright video meaningful context
    // showing the product UI before the API calls begin
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    // Use a unique email per test run to avoid conflicts with other parallel runs
    const uniqueEmail = `e2e-reg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fitsy.test`;
    const res = await request.post("/api/auth/register", {
      data: { email: uniqueEmail, password: TEST_PASSWORD, name: TEST_NAME },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("token");
    expect(body.user.email).toBe(uniqueEmail);
  });

  test("rejects duplicate registration with 409", async ({ request }) => {
    // Each test owns its own email — no dependency on other tests running first
    const dupeEmail = `e2e-dupe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fitsy.test`;

    // Register once
    await request.post("/api/auth/register", {
      data: { email: dupeEmail, password: TEST_PASSWORD },
    });

    // Try again with the same email
    const res = await request.post("/api/auth/register", {
      data: { email: dupeEmail, password: TEST_PASSWORD },
    });

    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already registered/i);
  });

  test("rejects missing email with 400", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      data: { password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects short password with 400", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      data: { email: `short-pw-${Date.now()}@fitsy.test`, password: "short" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });
});

test.describe("Auth flow — login", () => {
  test("logs in with valid credentials and returns 200 with token", async ({ request, page }) => {
    // Register the user first
    const uniqueEmail = `e2e-login-${Date.now()}@fitsy.test`;
    await request.post("/api/auth/register", {
      data: { email: uniqueEmail, password: TEST_PASSWORD, name: TEST_NAME },
    });

    // Navigate to landing page: gives Playwright video meaningful context
    await page.goto("/");

    // Login
    const res = await request.post("/api/auth/login", {
      data: { email: uniqueEmail, password: TEST_PASSWORD },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("token");
    expect(body.user.email).toBe(uniqueEmail);
  });

  test("rejects wrong password with 401", async ({ request }) => {
    const uniqueEmail = `e2e-badpw-${Date.now()}@fitsy.test`;
    await request.post("/api/auth/register", {
      data: { email: uniqueEmail, password: TEST_PASSWORD },
    });

    const res = await request.post("/api/auth/login", {
      data: { email: uniqueEmail, password: "WrongPassword1!" },
    });

    expect(res.status()).toBe(401);
  });

  test("rejects unknown email with 401", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email: "nobody@fitsy.test", password: TEST_PASSWORD },
    });
    expect(res.status()).toBe(401);
  });
});
