import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import { calculateTdee } from "@/lib/tdeeCalculator";
import type { ProfileUpdateRequest, ActivityLevel, UserGoal } from "@fitsy/shared";

// ─── Validation constants ────────────────────────────────────────────────────

const VALID_ACTIVITY_LEVELS: ActivityLevel[] = [
  "sedentary",
  "lightly_active",
  "active",
  "very_active",
];

const VALID_GOALS: UserGoal[] = ["lose_fat", "maintain", "build_muscle"];

// ─── PATCH /api/user/profile ─────────────────────────────────────────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body required" }, { status: 400 });
  }

  const update = body as Partial<ProfileUpdateRequest>;

  // ─── Field validation ──────────────────────────────────────────────────────

  if (update.age !== undefined) {
    if (
      typeof update.age !== "number" ||
      !Number.isInteger(update.age) ||
      update.age < 13 ||
      update.age > 99
    ) {
      return NextResponse.json(
        { error: "age must be an integer between 13 and 99" },
        { status: 400 },
      );
    }
  }

  if (update.weightKg !== undefined) {
    if (
      typeof update.weightKg !== "number" ||
      update.weightKg < 23 ||
      update.weightKg > 320
    ) {
      return NextResponse.json(
        { error: "weightKg must be between 23 and 320" },
        { status: 400 },
      );
    }
  }

  if (update.heightCm !== undefined) {
    if (
      typeof update.heightCm !== "number" ||
      update.heightCm < 122 ||
      update.heightCm > 229
    ) {
      return NextResponse.json(
        { error: "heightCm must be between 122 and 229" },
        { status: 400 },
      );
    }
  }

  if (update.activityLevel !== undefined) {
    if (!VALID_ACTIVITY_LEVELS.includes(update.activityLevel as ActivityLevel)) {
      return NextResponse.json(
        {
          error: `activityLevel must be one of: ${VALID_ACTIVITY_LEVELS.join(", ")}`,
        },
        { status: 400 },
      );
    }
  }

  if (update.goal !== undefined) {
    if (!VALID_GOALS.includes(update.goal as UserGoal)) {
      return NextResponse.json(
        { error: `goal must be one of: ${VALID_GOALS.join(", ")}` },
        { status: 400 },
      );
    }
  }

  if (update.onboardingStep !== undefined) {
    if (
      typeof update.onboardingStep !== "number" ||
      !Number.isInteger(update.onboardingStep) ||
      update.onboardingStep < 0
    ) {
      return NextResponse.json(
        { error: "onboardingStep must be a non-negative integer" },
        { status: 400 },
      );
    }
  }

  try {
    // ─── Update user profile ─────────────────────────────────────────────────

    const updatedUser = await prisma.user.update({
      where: { id: auth.sub },
      data: {
        ...(update.age !== undefined && { age: update.age }),
        ...(update.heightCm !== undefined && { heightCm: update.heightCm }),
        ...(update.weightKg !== undefined && { weightKg: update.weightKg }),
        ...(update.activityLevel !== undefined && {
          activityLevel: update.activityLevel,
        }),
        ...(update.goal !== undefined && { goal: update.goal }),
        ...(update.onboardingStep !== undefined && {
          onboardingStep: update.onboardingStep,
        }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        age: true,
        heightCm: true,
        weightKg: true,
        activityLevel: true,
        goal: true,
        onboardingStep: true,
      },
    });

    // ─── Auto-calculate TDEE if all required fields present ──────────────────

    if (
      updatedUser.age !== null &&
      updatedUser.heightCm !== null &&
      updatedUser.weightKg !== null &&
      updatedUser.activityLevel !== null &&
      updatedUser.goal !== null
    ) {
      const tdee = calculateTdee(
        updatedUser.age,
        updatedUser.heightCm,
        updatedUser.weightKg,
        updatedUser.activityLevel as ActivityLevel,
        updatedUser.goal as UserGoal,
      );

      await prisma.macroTarget.upsert({
        where: { userId: auth.sub },
        create: {
          userId: auth.sub,
          calories: tdee.calories,
          proteinG: tdee.proteinG,
          carbsG: tdee.carbsG,
          fatG: tdee.fatG,
          goalType: "maintain",
        },
        update: {
          calories: tdee.calories,
          proteinG: tdee.proteinG,
          carbsG: tdee.carbsG,
          fatG: tdee.fatG,
        },
      });
    }

    return NextResponse.json({ user: updatedUser }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
