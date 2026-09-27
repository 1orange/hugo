import { test } from "node:test";
import assert from "node:assert/strict";
import { stretchRasterContrast } from "../../../src/modules/raster-contrast.ts";

function grayRaster(values: number[], width: number) {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  return { data, width, height: values.length / width };
}

function channel(raster: { data: Uint8ClampedArray }, pixel: number): number {
  return raster.data[pixel * 4]!;
}

test("a faint scan is stretched to the full range", () => {
  // Like nákup PHL: nothing darker than 120.
  const values = Array.from({ length: 200 }, (_, index) => 120 + (index % 136));
  const stretched = stretchRasterContrast(grayRaster(values, 20));
  assert.ok(stretched);
  const channels = Array.from({ length: 200 }, (_, index) => channel(stretched, index));
  assert.ok(Math.min(...channels) <= 5);
  assert.ok(Math.max(...channels) >= 250);
});

test("an image that already spans the range is not retried", () => {
  const values = Array.from({ length: 256 }, (_, index) => index);
  assert.equal(stretchRasterContrast(grayRaster(values, 16)), null);
});

test("a flat image is not retried", () => {
  assert.equal(stretchRasterContrast(grayRaster(new Array(64).fill(200), 8)), null);
});

test("the stretched raster keeps its size, is gray and opaque", () => {
  const values = Array.from({ length: 100 }, (_, index) => 130 + (index % 100));
  const source = grayRaster(values, 10);
  const stretched = stretchRasterContrast(source);
  assert.ok(stretched);
  assert.equal(stretched.width, 10);
  assert.equal(stretched.height, 10);
  for (let pixel = 0; pixel < 100; pixel += 1) {
    const offset = pixel * 4;
    assert.equal(stretched.data[offset], stretched.data[offset + 1]);
    assert.equal(stretched.data[offset], stretched.data[offset + 2]);
    assert.equal(stretched.data[offset + 3], 255);
  }
});

test("darker source pixels stay darker after the stretch", () => {
  const values = [140, 140, 200, 200, 250, 250, 180, 160];
  const stretched = stretchRasterContrast(grayRaster(values, 4));
  assert.ok(stretched);
  assert.ok(channel(stretched, 0) < channel(stretched, 2));
  assert.ok(channel(stretched, 2) < channel(stretched, 4));
});
