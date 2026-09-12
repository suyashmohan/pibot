import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN devices (phone/tablet testing) to reach dev resources (HMR).
  // Override with PI_ALLOWED_DEV_ORIGINS="host1,host2" as the DHCP IP changes.
  allowedDevOrigins: process.env.PI_ALLOWED_DEV_ORIGINS
    ? process.env.PI_ALLOWED_DEV_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["192.168.68.55"],
  // No serverExternalPackages needed: sqlite comes from the Bun runtime
  // itself (`bun:sqlite`), not from a native npm addon.
  experimental: {
    // keep server actions available if needed later
  },
};

export default nextConfig;
