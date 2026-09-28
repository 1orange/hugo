import { test } from "node:test";
import assert from "node:assert/strict";
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
