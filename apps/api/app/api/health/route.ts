import { NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "connected",
      version: process.env["npm_package_version"] ?? "unknown",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", db: "unreachable", error: message },
      { status: 503 },
    );
  }
}
