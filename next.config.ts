import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only used for zero-setup local dev (no DATABASE_URL). Never imported in production.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
