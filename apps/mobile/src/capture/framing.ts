/**
 * Square framing guide → photo crop.
 *
 * The camera preview fills the screen "cover"-style (scaled up until both
 * dimensions fill the view, overflow cropped, centred). To crop the captured
 * photo to exactly what was inside the on-screen guide, map the guide's view
 * coordinates back through that scale/offset into image pixels.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  size: number;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The largest square that fits between the top UI (prompt card) and the bottom
 * UI (shutter row), with side margins, centred in that space.
 */
export function guideRect(view: Size, topEdge: number, bottomEdge: number, margin = 16): Rect {
  const available = Math.max(0, bottomEdge - topEdge - margin * 2);
  const size = Math.max(0, Math.min(view.width - margin * 2, available));
  return {
    x: (view.width - size) / 2,
    y: topEdge + margin + (available - size) / 2,
    size,
  };
}

/** Map a square in view coordinates to a pixel crop of the captured image. */
export function viewRectToImageCrop(rect: Rect, view: Size, image: Size): CropRect {
  // If the photo's orientation doesn't match the screen (phone held sideways),
  // the preview mapping doesn't apply — fall back to a centred square.
  const viewPortrait = view.height >= view.width;
  const imagePortrait = image.height >= image.width;
  if (viewPortrait !== imagePortrait || rect.size <= 0) return centreSquare(image);

  const scale = Math.max(view.width / image.width, view.height / image.height);
  const offsetX = (image.width * scale - view.width) / 2;
  const offsetY = (image.height * scale - view.height) / 2;

  let side = Math.round(rect.size / scale);
  let originX = Math.round((rect.x + offsetX) / scale);
  let originY = Math.round((rect.y + offsetY) / scale);

  // Clamp inside the image (rounding / tiny preview-vs-photo differences).
  side = Math.min(side, image.width, image.height);
  originX = Math.min(Math.max(0, originX), image.width - side);
  originY = Math.min(Math.max(0, originY), image.height - side);
  return { originX, originY, width: side, height: side };
}

export function centreSquare(image: Size): CropRect {
  const side = Math.min(image.width, image.height);
  return {
    originX: Math.round((image.width - side) / 2),
    originY: Math.round((image.height - side) / 2),
    width: side,
    height: side,
  };
}
