import {
  ApproveRequest,
  BulkApproveRequest,
  BulkApproveResult,
  BulkRematchRequest,
  BulkRematchResult,
  Capture,
  CaptureStatus,
  CatalogEntry,
  ResolveRequest,
} from "@sonic/shared";
import { z } from "zod";
import { bearerAuth, errors, IdParams } from "./common.js";

export const createCaptureSchema = {
  tags: ["captures"],
  summary: "Create a capture",
  description:
    "multipart/form-data upload. One file field per photo type (front, back, label_a, label_b, spine), plus optional text fields `barcodeHint` and `captureId` (a client-generated UUID; resending the same id returns the existing capture with 200 instead of creating a duplicate). Photos are re-encoded to progressive JPEG (≤2560px, metadata stripped). Recognition runs in the background; the capture starts as `processing`.",
  consumes: ["multipart/form-data"],
  security: bearerAuth,
  response: { 200: Capture, 201: Capture, ...errors(400, 401) },
};

export const listCapturesSchema = {
  tags: ["captures"],
  summary: "Review queue",
  description:
    "Pending captures (all pending_* statuses) by default; every capture with `status`; or `scope=unidentified` for everything not yet in the catalog (processing + pending_*), newest first.",
  security: bearerAuth,
  querystring: z.object({
    status: CaptureStatus.optional(),
    scope: z.enum(["review", "unidentified"]).optional(),
  }),
  response: { 200: z.array(Capture), ...errors(400, 401) },
};

export const getCaptureSchema = {
  tags: ["captures"],
  summary: "Get a capture",
  security: bearerAuth,
  params: IdParams,
  response: { 200: Capture, ...errors(400, 401, 404) },
};

export const approveCaptureSchema = {
  tags: ["captures"],
  summary: "Approve a capture",
  description:
    "Promote a pending capture into the catalog using `candidateId` (or the rank-1 candidate). Its tags are seeded from the release's source classifications. 409 if the capture isn't pending or has no candidate.",
  security: bearerAuth,
  params: IdParams,
  body: ApproveRequest.optional(),
  response: { 200: CatalogEntry, ...errors(400, 401, 404, 409) },
};

export const resolveCaptureSchema = {
  tags: ["captures"],
  summary: "Approve with confirmed data",
  description:
    "Approve a capture using owner-confirmed release data (usually the AI's reading, corrected) instead of a source match — for no-match captures, or when no candidate is right. Creates a 'manual' release and the catalog entry.",
  security: bearerAuth,
  params: IdParams,
  body: ResolveRequest,
  response: { 200: CatalogEntry, ...errors(400, 401, 404, 409) },
};

export const approveBulkSchema = {
  tags: ["captures"],
  summary: "Bulk-approve captures",
  description: "Approves each `pending_single` capture; anything else is returned in `skipped` with a reason.",
  security: bearerAuth,
  body: BulkApproveRequest,
  response: { 200: BulkApproveResult, ...errors(400, 401) },
};

export const rematchSchema = {
  tags: ["captures"],
  summary: "Search Discogs again",
  description:
    "Sends a capture back to the matcher (status → review) to search Discogs again with what the extractor read; its candidates are replaced when the search finishes. For captures in review or awaiting a match decision (pending_*). Responds 202 with the capture.",
  security: bearerAuth,
  params: IdParams,
  response: { 202: Capture, ...errors(400, 401, 404, 409) },
};

export const rematchBulkSchema = {
  tags: ["captures"],
  summary: "Search Discogs again for several captures",
  description:
    "Sends each capture back to the matcher; ones that can't be re-scanned (still being read, approved, skipped, not found) are returned in `skipped` with a reason.",
  security: bearerAuth,
  body: BulkRematchRequest,
  response: { 202: BulkRematchResult, ...errors(400, 401) },
};

export const reextractSchema = {
  tags: ["captures"],
  summary: "Read the photos again",
  description:
    "Sends a capture back to the extractor (status → processing). Only for captures in processing or review. Responds 202 with the capture.",
  security: bearerAuth,
  params: IdParams,
  response: { 202: Capture, ...errors(400, 401, 404, 409) },
};
