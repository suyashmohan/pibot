import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No serverExternalPackages needed: sqlite comes from the Bun runtime
  // itself (`bun:sqlite`), not from a native npm addon.
  experimental: {
    // keep server actions available if needed later
  },
};

export default nextConfig;
