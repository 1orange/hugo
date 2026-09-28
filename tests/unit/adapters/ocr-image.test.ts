import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { OCR_MAX_SIDE_PX, prepareImageForOcr } from "../../../src/adapters/image/ocr-image.ts";

async function metadataOf(image: Awaited<ReturnType<typeof prepareImageForOcr>>) {
  assert.equal(image.kind, "encoded");
  return sharp(Buffer.from(image.kind === "encoded" ? image.bytes : new Uint8Array())).metadata();
}

// A 600 dpi scan's page image arrives as raw RGBA.
test("a large page is sent no longer than the OCR reads, in grayscale", async () => {
  const width = 5088;
  const height = 7008;
  const data = new Uint8ClampedArray(width * height * 4).fill(200);
  const prepared = await prepareImageForOcr({ kind: "rgba", data, width, height });
  const metadata = await metadataOf(prepared);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.height, OCR_MAX_SIDE_PX);
  assert.equal(metadata.width, Math.round((width * OCR_MAX_SIDE_PX) / height));
  assert.equal(metadata.channels, 1);
  assert.ok(prepared.kind === "encoded" && prepared.bytes.length < 1_000_000);
});

test("a small image is not enlarged", async () => {
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const metadata = await metadataOf(await prepareImageForOcr({ kind: "encoded", bytes: new Uint8Array(jpeg) }));
  assert.deepEqual([metadata.width, metadata.height], [800, 600]);
});

// A phone photo is stored landscape with an EXIF note to turn it.
test("a photo is turned upright from its EXIF orientation", async () => {
  const sideways = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#fff" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const metadata = await metadataOf(await prepareImageForOcr({ kind: "encoded", bytes: new Uint8Array(sideways) }));
  assert.deepEqual([metadata.width, metadata.height], [200, 300]);
});

test("an image sharp cannot read is sent as it came", async () => {
  const unknown = { kind: "encoded" as const, bytes: new Uint8Array([0xff, 0xd8, 0xff]) };
  assert.equal(await prepareImageForOcr(unknown), unknown);
});
