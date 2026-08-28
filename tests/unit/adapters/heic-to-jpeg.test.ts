import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { heicToJpeg } from "../../../src/adapters/image/heic-to-jpeg.ts";

/**
 * The only HEIC in the real corpus. Kept outside the repo because it is a
 * client's photo, so this check skips rather than fails when it is absent.
 */
const SAMPLE_HEIC =
  process.env.HEIC_SAMPLE_PATH ??
  "/Users/jean/Downloads/spring/2026_05/04 Bločky_hotorvosť/IMG_3475.HEIC";

test("converts a real HEIC photo to a JPEG the browser can render", async (t) => {
  if (!existsSync(SAMPLE_HEIC)) {
    t.skip(`sample not present at ${SAMPLE_HEIC}`);
    return;
  }

  const jpeg = await heicToJpeg(readFileSync(SAMPLE_HEIC));

  assert.deepEqual(
    [...jpeg.subarray(0, 3)],
    [0xff, 0xd8, 0xff],
    "output does not start with the JPEG marker",
  );
  assert.deepEqual([...jpeg.subarray(-2)], [0xff, 0xd9], "JPEG is truncated");
  assert.ok(jpeg.length > 50_000, `suspiciously small output: ${jpeg.length} bytes`);
});
