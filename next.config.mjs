import path from "node:path";

/**
 * Plain JavaScript: with next.config.ts, `next start` in the production image
 * (no dev dependencies) stops to install TypeScript before it serves anything.
 *
 * @type {import("next").NextConfig}
 */
const nextConfig = {
  serverExternalPackages: [
    "pdfjs-dist",
    // Loads its .wasm relative to its own module file, which bundling breaks.
    "zxing-wasm",
  ],
  outputFileTracingRoot: path.join(import.meta.dirname),
  allowedDevOrigins: ["127.0.0.1:3000", "localhost:3000"],
};

export default nextConfig;
