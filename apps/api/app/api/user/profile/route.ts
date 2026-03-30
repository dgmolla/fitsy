import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import { calculateTdee } from "@/lib/tdeeCalculator";
import { calculateAge } from "@fitsy/shared";
import type {
  ProfileUpdateRequest,
  ProfileResponse,
  ActivityLevel,
  UserGoal,
} from "@fitsy/shared";

// ─── Validation constants ────────────────────────────────────────────────────

const VALID_ACTIVITY_LEVELS: ActivityLevel[] = [
  "sedentary",
  "lightly_active",
  "active",
  "very_active",
];

const VALID_GOALS: UserGoal[] = ["lose_fat", "maintain", "build_muscle"];

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  birthday: true,
  heightCm: true,
  weightKg: true,
  activityLevel: true,
  goal: true,
  onboardingStep: true,
} as const;

// ─── GET /api/user/profile ──────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: {
        ...USER_SELECT,
        macroTarget: {
          select: {
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const response: ProfileResponse = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        birthday: user.birthday?.toISOString().split("T")[0] ?? null,
        age: user.birthday ? calculateAge(user.birthday) : null,
        heightCm: user.heightCm,
        weightKg: user.weightKg,
        activityLevel: user.activityLevel as ActivityLevel | null,
        goal: user.goal as UserGoal | null,
        onboardingStep: user.onboardingStep,
      },
      macroTarget: user.macroTarget
        ? {
            calories: user.macroTarget.calories,
            proteinG: user.macroTarget.proteinG,
            carbsG: user.macroTarget.carbsG,
            fatG: user.macroTarget.fatG,
          }
        : null,
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

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

  if (update.birthday !== undefined) {
    if (typeof update.birthday !== "string") {
      return NextResponse.json(
        { error: "birthday must be a date string (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    const parsed = new Date(update.birthday);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "birthday must be a valid date (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    const age = calculateAge(parsed);
    if (age < 13 || age > 99) {
      return NextResponse.json(
        { error: "user must be between 13 and 99 years old" },
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
        ...(update.birthday !== undefined && {
          birthday: new Date(update.birthday),
        }),
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
      select: USER_SELECT,
    });

    // ─── Explicit macro targets override auto-calc ───────────────────────────

    if (update.macroTarget) {
      await prisma.macroTarget.upsert({
        where: { userId: auth.sub },
        create: {
          userId: auth.sub,
          calories: update.macroTarget.calories,
          proteinG: update.macroTarget.proteinG,
          carbsG: update.macroTarget.carbsG,
          fatG: update.macroTarget.fatG,
          goalType: "maintain",
        },
        update: {
          calories: update.macroTarget.calories,
          proteinG: update.macroTarget.proteinG,
          carbsG: update.macroTarget.carbsG,
          fatG: update.macroTarget.fatG,
        },
      });
    } else if (
      updatedUser.birthday !== null &&
      updatedUser.heightCm !== null &&
      updatedUser.weightKg !== null &&
      updatedUser.activityLevel !== null &&
      updatedUser.goal !== null
    ) {
      // Auto-calculate TDEE only when no explicit macros provided
      const tdee = calculateTdee(
        calculateAge(updatedUser.birthday),
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

    return NextResponse.json(
      {
        user: {
          ...updatedUser,
          birthday: updatedUser.birthday
            ? updatedUser.birthday.toISOString().split("T")[0]
            : null,
          age: updatedUser.birthday
            ? calculateAge(updatedUser.birthday)
            : null,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
