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
    return new FakeOcr();
  }

  return createHttpOcr({ baseUrl });
}
