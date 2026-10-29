import { withApiTelemetry } from '@/lib/apiTelemetry';
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { deepHealth, boundedHealthCheck } from '@/lib/dependencyHealth';

export const dynamic = "force-dynamic";
export const revalidate = 0;

function deploymentSha(): string | null {
  const sha = process.env["VERCEL_GIT_COMMIT_SHA"];
  return sha && /^[0-9a-fA-F]{40}$/.test(sha) ? sha.toLowerCase() : null;
}

async function handleGET(request: NextRequest) {
  const deployedSha = deploymentSha();

  if (request.nextUrl.searchParams.get('deep') === '1') {
    const secret = process.env['CRON_SECRET'];
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const dependencies = await deepHealth();
    const healthy = Object.values(dependencies).every(value => value === 'ok');
    return NextResponse.json({ status: healthy ? 'ok' : 'error', deploymentSha: deployedSha, dependencies },
      { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }

  try {
    await boundedHealthCheck(() => prisma.$queryRaw`SELECT 1`);
    return NextResponse.json({
      status: "ok",
      db: "connected",
      deploymentSha: deployedSha,
      version: process.env["npm_package_version"] ?? "unknown",
      timestamp: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { status: "error", db: "unreachable", deploymentSha: deployedSha, error: "Service unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = withApiTelemetry('GET', '/api/health', handleGET);
