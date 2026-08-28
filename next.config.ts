import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ["127.0.0.1:3000", "localhost:3000"],
};

export default nextConfig;
