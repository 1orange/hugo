import type { RgbaRaster } from "./raster-contrast";

/**
 * Darkens each pixel to the darkest of its neighbours along one axis — a
 * one-dimensional grey-level erosion of the light areas.
 *
 * A thermal printer with a dead dot leaves a thin light streak through every
 * QR module on that column, which defeats the decoder while a phone camera,
 * averaging frames, still reads it. `IMG_3440` (Slovnaft) decodes once the
 * streaks are closed 3–5 px across. The streak direction depends on how the
 * receipt lies in the image, so callers try both axes.
 *
 * `across: "x"` looks at left and right neighbours and so closes streaks that
 * run vertically; `across: "y"` closes streaks that run horizontally.
 *
 * The minimum over each window is taken with a monotonic deque (a sliding-window
 * minimum), so the cost is linear in the pixel count and does not grow with
 * `width`. Neighbours outside the image are ignored at the edges.
 */
export function closeLightStreaks(
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
  const darkest = new Uint8Array(pixelCount);
  if (!(reach >= 0)) {
    // A negative or NaN width leaves the window empty: nothing is darkened.
    darkest.fill(255);
  } else if (options.across === "x") {
    // Rows: samples are adjacent, lines are `width` apart.
    minimumAlongLines(luminance, darkest, height, width, width, 1, reach);
  } else if (options.across === "y") {
    // Columns: samples are `width` apart, lines are adjacent.
    minimumAlongLines(luminance, darkest, width, height, 1, width, reach);
  } else {
    darkest.set(luminance);
  }

  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = darkest[pixel]!;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

/**
 * For every sample of every line, writes the minimum of the samples within
 * `reach` of it (clipped to the line) into `target`.
 *
 * Sample `k` of line `l` lives at `l * lineStep + k * sampleStep` in both arrays.
 * The deque holds sample positions whose values increase from front to back;
 * the front is the window minimum.
 */
function minimumAlongLines(
  source: Uint8Array,
  target: Uint8Array,
  lineCount: number,
  lineLength: number,
  lineStep: number,
  sampleStep: number,
  reach: number,
): void {
  const queue = new Int32Array(lineLength);
  for (let line = 0; line < lineCount; line += 1) {
    const base = line * lineStep;
    let head = 0;
    let tail = 0;
    let nextToEnter = 0;
    for (let k = 0; k < lineLength; k += 1) {
      const enterUpTo = Math.min(lineLength - 1, k + reach);
      while (nextToEnter <= enterUpTo) {
        const value = source[base + nextToEnter * sampleStep]!;
        while (tail > head && source[base + queue[tail - 1]! * sampleStep]! >= value) {
          tail -= 1;
        }
        queue[tail] = nextToEnter;
        tail += 1;
        nextToEnter += 1;
      }
      const leaveBefore = k - reach;
      while (queue[head]! < leaveBefore) {
        head += 1;
      }
      target[base + k * sampleStep] = source[base + queue[head]! * sampleStep]!;
    }
  }
}
