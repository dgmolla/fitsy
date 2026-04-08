import type { NextConfig } from "next";

const securityHeaders = [
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

export default nextConfig;
