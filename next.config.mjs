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
    // HEIC photos: libheif-js under it loads its wasm through a dynamic require
    // webpack cannot follow ("Critical dependency"), so it is left to Node.
    "heic-convert",
    // Imports the optional @valkey/valkey-glide client, which is not installed
    // ("Module not found" on every compile); Node only loads it if configured.
    "bullmq",
  ],
  outputFileTracingRoot: path.join(import.meta.dirname),
  allowedDevOrigins: ["127.0.0.1:3000", "localhost:3000"],
};

export default nextConfig;
