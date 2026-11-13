import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs';

const securityHeaders = [
  // Never share authenticated API responses or auth failures across callers.
  { key: "Cache-Control", value: "private, no-store" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Block clickjacking (API server, not rendered in iframes)
  { key: "X-Frame-Options", value: "DENY" },
  // Force HTTPS for 1 year (includeSubDomains, no preload — can tighten later)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Restrict referrer information sent to external origins
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Minimal permissions policy — API server needs no browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Transpile shared package from monorepo
  transpilePackages: ["@fitsy/shared"],

  async headers() {
    return [
      {
        // Apply security headers to all API routes
        source: "/api/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // SENTRY_ORG, SENTRY_PROJECT and SENTRY_AUTH_TOKEN are read by the build plugin.
  telemetry: false,
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  release: { name: `fitsy-api@${process.env.VERCEL_GIT_COMMIT_SHA ?? 'development'}`, dist: 'server' },
  webpack: {
    autoInstrumentServerFunctions: false,
    autoInstrumentMiddleware: false,
    autoInstrumentAppDirectory: false,
  },
});
