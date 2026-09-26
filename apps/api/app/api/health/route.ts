import { NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function deploymentSha(): string | null {
  const sha = process.env["VERCEL_GIT_COMMIT_SHA"];
  return sha && /^[0-9a-fA-F]{40}$/.test(sha) ? sha.toLowerCase() : null;
}

export async function GET() {
  const deployedSha = deploymentSha();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "connected",
      deploymentSha: deployedSha,
      version: process.env["npm_package_version"] ?? "unknown",
      timestamp: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", db: "unreachable", deploymentSha: deployedSha, error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
