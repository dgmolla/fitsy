// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockPrismaUserUpdate = jest.fn();
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserCreate = jest.fn();
const mockPrismaMacroTargetUpsert = jest.fn();
const mockCalculateTdee = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: {
      update: mockPrismaUserUpdate,
      findUnique: mockPrismaUserFindUnique,
      create: mockPrismaUserCreate,
    },
    macroTarget: {
      upsert: mockPrismaMacroTargetUpsert,
    },
  },
}));

jest.mock("@/lib/tdeeCalculator", () => ({
  calculateTdee: mockCalculateTdee,
}));

import { PATCH } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };
const MOCK_USER_BASE = {
  id: "user-1",
  email: "alice@example.com",
  name: "Alice",
  age: null,
  heightCm: null,
  weightKg: null,
  activityLevel: null,
  goal: null,
  onboardingStep: 0,
};

function makeRequest(body: unknown, authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("PATCH /api/user/profile — auth guard", () => {
  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(makeRequest({ age: 30 }));
    expect(res.status).toBe(401);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("PATCH /api/user/profile — validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
  });

  it("returns 400 for age below 13", async () => {
    const res = await PATCH(makeRequest({ age: 12 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age/i);
  });

  it("returns 400 for age above 99", async () => {
    const res = await PATCH(makeRequest({ age: 100 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age/i);
  });

  it("returns 400 for weightKg below 23", async () => {
    const res = await PATCH(makeRequest({ weightKg: 20 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/weightKg/i);
  });

  it("returns 400 for weightKg above 320", async () => {
    const res = await PATCH(makeRequest({ weightKg: 350 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/weightKg/i);
  });

  it("returns 400 for heightCm below 122", async () => {
    const res = await PATCH(makeRequest({ heightCm: 100 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/heightCm/i);
  });

  it("returns 400 for heightCm above 229", async () => {
    const res = await PATCH(makeRequest({ heightCm: 300 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/heightCm/i);
  });

  it("returns 400 for invalid activityLevel", async () => {
    const res = await PATCH(makeRequest({ activityLevel: "super_active" }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/activityLevel/i);
  });

  it("returns 400 for invalid goal", async () => {
    const res = await PATCH(makeRequest({ goal: "cut" }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/goal/i);
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("PATCH /api/user/profile — success", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
  });

  it("updates partial profile fields and returns updated user", async () => {
    const updatedUser = { ...MOCK_USER_BASE, age: 30, onboardingStep: 1 };
    mockPrismaUserUpdate.mockResolvedValue(updatedUser);

    const res = await PATCH(
      makeRequest({ age: 30, onboardingStep: 1 }, "Bearer valid"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.age).toBe(30);
    expect(body.user.onboardingStep).toBe(1);
    expect(mockPrismaMacroTargetUpsert).not.toHaveBeenCalled();
  });

  it("calculates TDEE and upserts MacroTarget when all fields are set", async () => {
    const fullUser = {
      ...MOCK_USER_BASE,
      age: 28,
      heightCm: 170,
      weightKg: 70,
      activityLevel: "active",
      goal: "maintain",
      onboardingStep: 5,
    };
    mockPrismaUserUpdate.mockResolvedValue(fullUser);
    mockCalculateTdee.mockReturnValue({
      calories: 2500,
      proteinG: 188,
      carbsG: 250,
      fatG: 83,
    });
    mockPrismaMacroTargetUpsert.mockResolvedValue({});

    const res = await PATCH(
      makeRequest(
        {
          age: 28,
          heightCm: 170,
          weightKg: 70,
          activityLevel: "active",
          goal: "maintain",
          onboardingStep: 5,
        },
        "Bearer valid",
      ),
    );

    expect(res.status).toBe(200);
    expect(mockCalculateTdee).toHaveBeenCalledWith(28, 170, 70, "active", "maintain");
    expect(mockPrismaMacroTargetUpsert).toHaveBeenCalledTimes(1);
  });
});
