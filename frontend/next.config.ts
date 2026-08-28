import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The icon barrel is thousands of modules; without this, dev compiles crawl.
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
};

export default nextConfig;
