export type RgbaRaster = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

// Below this spread the image already uses (nearly) the whole range and a
// stretch changes nothing worth a second decode.
const FULL_RANGE_LOW = 16;
const FULL_RANGE_HIGH = 239;

/**
 * Grayscale plus a 1st–99th percentile contrast stretch.
 *
 * Faint thermal-paper scans defeat the QR binariser: `nákup PHL_2026_03.pdf`
 * only spans luminance 120–255 and decodes after this stretch but not at any
 * resolution without it. Returns null when the image already spans the range,
 * so the caller can skip a pointless retry.
 */
export function stretchRasterContrast(image: RgbaRaster): RgbaRaster | null {
  const pixelCount = image.width * image.height;
  if (pixelCount === 0) {
    return null;
  }

  const luminance = new Uint8ClampedArray(pixelCount);
  const histogram = new Array<number>(256).fill(0);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value =
      0.299 * image.data[offset]! +
      0.587 * image.data[offset + 1]! +
      0.114 * image.data[offset + 2]!;
    luminance[pixel] = value;
    histogram[luminance[pixel]!] += 1;
  }

  const low = percentileValue(histogram, pixelCount, 0.01);
  const high = percentileValue(histogram, pixelCount, 0.99);
  if (low <= FULL_RANGE_LOW && high >= FULL_RANGE_HIGH) {
    return null;
  }
  if (high <= low) {
    return null;
  }

  const scale = 255 / (high - low);
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const stretched = (luminance[pixel]! - low) * scale;
    const offset = pixel * 4;
    data[offset] = stretched;
    data[offset + 1] = stretched;
    data[offset + 2] = stretched;
    data[offset + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}

function percentileValue(
  histogram: number[],
  total: number,
  fraction: number,
): number {
  const target = total * fraction;
  let cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value]!;
    if (cumulative > target) {
      return value;
    }
  }
  return 255;
}
