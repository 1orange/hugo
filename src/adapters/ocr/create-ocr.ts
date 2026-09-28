import { createHttpOcr } from "./http-ocr";
import { FakeOcr } from "./fake-ocr";
import type { Ocr } from "./port";

export function createOcr(env: NodeJS.ProcessEnv = process.env): Ocr {
  const mode = env.OCR?.trim().toLowerCase();
  if (mode === "fake" || env.DRIVE_CLIENT === "fake") {
    return new FakeOcr();
  }

  const baseUrl = env.OCR_URL?.trim();
  if (!baseUrl) {
    if (env.NODE_ENV === "production") {
      throw new Error("OCR_URL is required in production");
    }
    // As for the extractor: unconfigured means "not reachable", so image
    // documents wait for OCR instead of failing on a fake that reads nothing.
    return {
      async recognize() {
        throw new Error("OCR is unreachable: OCR_URL is not set.");
      },
    };
  }

  return createHttpOcr({ baseUrl });
}
