import type { PhotoType } from "@sonic/shared";

/** What's being photographed — drives which shots the guided capture asks for. */
export type MediaKind = "vinyl" | "cd";

export interface ShotSpec {
  type: PhotoType;
  label: string;
  hint: string;
  required: boolean;
  /**
   * Show a square framing guide and crop the photo to it, so square subjects
   * (sleeves, labels, CD booklet/disc) are stored without background.
   */
  square: boolean;
}

/**
 * Guided shot lists. Both map onto the shared PhotoType enum so the server and
 * pipeline need no media-specific handling (a CD's disc face is `label_a`).
 * Order is the order the camera walks through them.
 */
export const SHOTS: Record<MediaKind, ShotSpec[]> = {
  vinyl: [
    { type: "front", label: "Front cover", hint: "Line the sleeve edges up with the frame", required: true, square: true },
    { type: "back", label: "Back cover", hint: "Line the sleeve edges up with the frame", required: false, square: true },
    { type: "label_a", label: "Label — side A", hint: "Fit the label inside the frame; catalog number in focus", required: false, square: true },
    { type: "label_b", label: "Label — side B", hint: "Optional — fit the label inside the frame", required: false, square: true },
  ],
  cd: [
    { type: "front", label: "Front cover", hint: "Line the booklet edges up with the frame", required: true, square: true },
    { type: "back", label: "Back of case", hint: "Include the barcode if there is one", required: false, square: false },
    { type: "label_a", label: "Disc face", hint: "Fit the disc inside the frame; catalog no. is on the inner ring", required: false, square: true },
    { type: "spine", label: "Spine", hint: "Optional", required: false, square: false },
  ],
};

export interface TakenPhoto {
  type: PhotoType;
  uri: string;
}
