/**
 * Normalizes every uploaded photo to one storage format, whatever the client
 * sent (mobile JPEG, browser PNG/WebP, AVIF, …).
 *
 * Format: progressive JPEG (mozjpeg, q82, 4:2:0, sRGB), long edge ≤ 2560px.
 * JPEG because it opens everywhere — every browser/OS/email client and the
 * OCR / vision APIs the recognition pipeline calls — and mozjpeg keeps sizes
 * close to WebP. 2560px keeps catalog numbers and fine label print legible.
 * Photos are auto-rotated from EXIF, then all metadata (incl. GPS) is stripped.
 */
import sharp from "sharp";
import { BadRequestError } from "../errors.js";

export const STORED_IMAGE = {
  contentType: "image/jpeg",
  extension: "jpg",
  maxEdge: 2560,
  quality: 82,
} as const;

export interface ProcessedImage {
  data: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
}

export interface ImageProcessor {
  /** Re-encode to the storage format. Throws BadRequestError for non-images. */
  normalize(input: Buffer): Promise<ProcessedImage>;
}

export class SharpImageProcessor implements ImageProcessor {
  async normalize(input: Buffer): Promise<ProcessedImage> {
    try {
      const { data, info } = await sharp(input, { failOn: "error" })
        .rotate() // apply EXIF orientation before metadata is dropped
        .resize({
          width: STORED_IMAGE.maxEdge,
          height: STORED_IMAGE.maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .toColorspace("srgb")
        .jpeg({
          quality: STORED_IMAGE.quality,
          mozjpeg: true,
          progressive: true,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer({ resolveWithObject: true });
      return {
        data,
        contentType: STORED_IMAGE.contentType,
        extension: STORED_IMAGE.extension,
        width: info.width,
        height: info.height,
      };
    } catch {
      throw new BadRequestError(
        "unsupported image: upload JPEG, PNG, WebP or AVIF (HEIC isn't supported)",
      );
    }
  }
}
