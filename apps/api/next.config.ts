import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile shared package from monorepo
  transpilePackages: ["@fitsy/shared"],
};

export default nextConfig;
