import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "pdfjs-dist",
    // Loads its .wasm relative to its own module file, which bundling breaks.
    "zxing-wasm",
  ],
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ["127.0.0.1:3000", "localhost:3000"],
};

export default nextConfig;
