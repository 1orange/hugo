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
