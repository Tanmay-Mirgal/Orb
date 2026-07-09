import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["database", "shared", "storage"],
};

export default nextConfig;
