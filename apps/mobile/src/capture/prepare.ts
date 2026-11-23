import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { CropRect } from "./framing.js";

/**
 * Longest edge we upload — matches the server's stored size (2560px), so the
 * server never has to downscale and nothing is lost. Full-res phone photos are
 * 4–8 MB; this cuts uploads several-fold while keeping catalog numbers sharp.
 */
const MAX_EDGE = 2560;

/**
 * Optionally crop (e.g. to the square framing guide), then downscale and
 * re-encode a captured photo to a reasonably sized JPEG.
 */
export async function prepareForUpload(
  uri: string,
  width: number,
  height: number,
  crop?: CropRect,
): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (crop) {
    ctx.crop(crop);
    width = crop.width;
    height = crop.height;
  }
  if (Math.max(width, height) > MAX_EDGE) {
    ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return saved.uri;
}
