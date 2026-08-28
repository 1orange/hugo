/**
 * HEIC decode via libheif compiled to WASM, so the VPS needs no native build
 * and the browser needs no decoder.
 */
export async function heicToJpeg(
  input: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  // ponytail: decodes the whole image inside the request, roughly a second for a
  // phone photo, with no cache. Ceiling is one conversion per preview open;
  // upgrade path is storing the JPEG alongside the file row.
  const { default: convert } = await import("heic-convert");
  const jpeg = await convert({ buffer: input, format: "JPEG", quality: 0.8 });
  return new Uint8Array(jpeg);
}
