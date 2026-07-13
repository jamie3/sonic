# Remaining Stubs — Implementation Plan

Three stubbed features remain. They are independent and can be tackled in any
order. Recorded here for later; current focus is the web app.

## 1. Mobile camera capture flow (`apps/mobile`)

The primary use case. Guided multi-photo capture + on-device barcode scan, then
`createCapture`.

- Multi-photo capture UI (front cover, back cover, label, etc.) via `expo-camera`.
- On-device barcode scan (UPC/EAN) during capture.
- Upload photos + call `createCapture` to kick off the pipeline.
- Makes the whole pipeline demoable end-to-end: capture → upload → Discogs → approve.
- **Best verified on a physical device or simulator.** Substantial UI work.

## 2. Server-side barcode decode

Fallback to the on-device scan.

- Decode a barcode from an uploaded photo using `@zxing/library`.
- Runs server-side when the mobile on-device scan misses or isn't available.
- No hardware needed to verify — test with sample images.

## 3. Tesseract OCR

Read catalog number / label text from the label photos.

- OCR the label photos to extract catalog number and label text.
- Quality/coverage booster for when the vision model falls short.
- No hardware needed to verify — test with sample images.

## Notes

- Barcode-decode and OCR are quality/coverage boosters; they mostly help when
  the on-device scan and vision model fall short.
- A Discogs token is needed to exercise the metadata-lookup pipeline for real.
  Wire it into the root `.env` (`DISCOGS_TOKEN`).
