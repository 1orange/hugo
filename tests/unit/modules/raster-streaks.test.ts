import { test } from "node:test";
import assert from "node:assert/strict";
import type { RgbaRaster } from "../../../src/modules/raster-contrast.ts";
import { closeLightStreaks } from "../../../src/modules/raster-streaks.ts";

function grayRaster(rows: number[][]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.flat().forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  return { data, width, height };
}

function lum(raster: { data: Uint8ClampedArray; width: number }, x: number, y: number): number {
  return raster.data[(y * raster.width + x) * 4]!;
}

// A dark module crossed by a one-pixel light streak running top to bottom,
// the way a thermal print head's dead dot leaves it.
const verticalStreak = grayRaster([
  [0, 0, 255, 0, 0],
  [0, 0, 255, 0, 0],
  [0, 0, 255, 0, 0],
]);

test("closing across x fills a light streak that runs vertically", () => {
  const closed = closeLightStreaks(verticalStreak, { across: "x", width: 3 });
  assert.equal(lum(closed, 2, 1), 0);
});

test("closing across y leaves a vertical streak open", () => {
  const closed = closeLightStreaks(verticalStreak, { across: "y", width: 3 });
  assert.equal(lum(closed, 2, 1), 255);
});

test("closing across y fills a light streak that runs horizontally", () => {
  const horizontalStreak = grayRaster([
    [0, 0, 0],
    [255, 255, 255],
    [0, 0, 0],
  ]);
  const closed = closeLightStreaks(horizontalStreak, { across: "y", width: 3 });
  assert.equal(lum(closed, 1, 1), 0);
});

test("a light area wider than the filter stays light", () => {
  const wideGap = grayRaster([[0, 255, 255, 255, 255, 255, 0]]);
  const closed = closeLightStreaks(wideGap, { across: "x", width: 3 });
  assert.equal(lum(closed, 3, 0), 255);
});

test("the output keeps its size, is gray and opaque", () => {
  const closed = closeLightStreaks(verticalStreak, { across: "x", width: 5 });
  assert.equal(closed.width, 5);
  assert.equal(closed.height, 3);
  for (let pixel = 0; pixel < 15; pixel += 1) {
    const offset = pixel * 4;
    assert.equal(closed.data[offset], closed.data[offset + 1]);
    assert.equal(closed.data[offset + 3], 255);
  }
});

// The original implementation, kept verbatim as the reference for the linear
// filter above: for every pixel it scans the whole window, O(pixels × width).
function closeLightStreaksReference(
  image: RgbaRaster,
  options: { across: "x" | "y"; width: number },
): RgbaRaster {
  const { width, height } = image;
  const pixelCount = width * height;
  const luminance = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    luminance[pixel] =
      0.299 * image.data[offset]! +
      0.587 * image.data[offset + 1]! +
      0.114 * image.data[offset + 2]!;
  }

  const reach = Math.floor(options.width / 2);
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let darkest = 255;
      for (let step = -reach; step <= reach; step += 1) {
        const nx = options.across === "x" ? x + step : x;
        const ny = options.across === "y" ? y + step : y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const value = luminance[ny * width + nx]!;
        if (value < darkest) {
          darkest = value;
        }
      }
      const offset = (y * width + x) * 4;
      data[offset] = darkest;
      data[offset + 1] = darkest;
      data[offset + 2] = darkest;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

// Mulberry32: a small seeded PRNG, so a failure reproduces exactly.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `binary` gives every channel 0 or 255, so many windows hold equal values
// and the filter's tie handling is exercised too.
function randomRaster(
  random: () => number,
  width: number,
  height: number,
  binary: boolean,
): RgbaRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = binary ? (random() < 0.5 ? 0 : 255) : Math.floor(random() * 256);
  }
  return { data, width, height };
}

function assertSameRaster(actual: RgbaRaster, expected: RgbaRaster, description: string) {
  assert.ok(actual.data instanceof Uint8ClampedArray, description);
  assert.equal(actual.width, expected.width, description);
  assert.equal(actual.height, expected.height, description);
  assert.equal(actual.data.length, expected.data.length, description);
  const difference = actual.data.findIndex((value, index) => value !== expected.data[index]);
  assert.equal(
    difference,
    -1,
    `${description}: byte ${difference} is ${actual.data[difference]}, expected ${expected.data[difference]}`,
  );
}

test("matches the original implementation byte for byte on random rasters", () => {
  const random = seededRandom(0x5eed);
  const sizes: [number, number][] = [
    [1, 1],
    [1, 9],
    [9, 1],
    [2, 7],
    [7, 2],
    [5, 5],
    [13, 9],
    [200, 150],
  ];
  // Odd and even widths, width 1 (no reach), width 0 and negative or fractional
  // widths (degenerate, as the original handled them), and a width wider than
  // the image.
  const widths = [-3, 0, 1, 2, 2.5, 3, 4, 5, 6, 7, 40];
  for (const [width, height] of sizes) {
    for (const filterWidth of widths) {
      for (const across of ["x", "y"] as const) {
        for (const binary of [false, true]) {
          const image = randomRaster(random, width, height, binary);
          const description = `${width}x${height} across=${across} width=${filterWidth} binary=${binary}`;
          assertSameRaster(
            closeLightStreaks(image, { across, width: filterWidth }),
            closeLightStreaksReference(image, { across, width: filterWidth }),
            description,
          );
        }
      }
    }
  }
});
