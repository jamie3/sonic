import { TrashKind, TrashList } from "@sonic/shared";
import { z } from "zod";
import { bearerAuth, errors, IdParams } from "./common.js";

const KindParams = z.object({ kind: TrashKind, id: z.string().uuid() });

export const trashEntrySchema = {
  tags: ["trash"],
  summary: "Move a catalog entry to the trash",
  description: "Soft delete. It disappears from the catalog and is permanently deleted after the retention period unless restored. Responds 204.",
  security: bearerAuth,
  params: IdParams,
  response: { ...errors(400, 401, 404) },
};

export const trashCaptureSchema = {
  tags: ["trash"],
  summary: "Move an unidentified capture to the trash",
  description: "Soft delete for uploads that aren't catalog entries. 409 for approved captures (delete their catalog entry instead). Responds 204.",
  security: bearerAuth,
  params: IdParams,
  response: { ...errors(400, 401, 404, 409) },
};

export const listTrashSchema = {
  tags: ["trash"],
  summary: "List the trash",
  description: "Most recently deleted first, with when each item will be permanently deleted.",
  security: bearerAuth,
  response: { 200: TrashList, ...errors(401) },
};

export const restoreSchema = {
  tags: ["trash"],
  summary: "Restore an item from the trash",
  description: "Responds 204.",
  security: bearerAuth,
  params: KindParams,
  response: { ...errors(400, 401, 404) },
};

export const purgeSchema = {
  tags: ["trash"],
  summary: "Delete an item forever",
  description: "Permanently deletes a trashed item and its photos now. Only works on items already in the trash. Responds 204.",
  security: bearerAuth,
  params: KindParams,
  response: { ...errors(400, 401, 404) },
};

export const emptyTrashSchema = {
  tags: ["trash"],
  summary: "Empty the trash",
  description: "Permanently deletes everything in the trash now.",
  security: bearerAuth,
  response: {
    200: z.object({ entries: z.number().int(), captures: z.number().int() }),
    ...errors(401),
  },
};
