import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { TrashController } from "../controllers/trash.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  emptyTrashSchema,
  listTrashSchema,
  purgeSchema,
  restoreSchema,
  trashCaptureSchema,
  trashEntrySchema,
} from "../schemas/trash.schema.js";

export const trashRoutes: FastifyPluginAsyncZod = async (app) => {
  const c = new TrashController(app.services.trash);
  app.addHook("preHandler", requireAuth);

  // Moving to the trash is DELETE on the item itself.
  app.delete("/catalog/:id", { schema: trashEntrySchema }, c.trashEntry);
  app.delete("/captures/:id", { schema: trashCaptureSchema }, c.trashCapture);

  app.get("/trash", { schema: listTrashSchema }, c.list);
  app.delete("/trash", { schema: emptyTrashSchema }, c.empty);
  app.post("/trash/:kind/:id/restore", { schema: restoreSchema }, c.restore);
  app.delete("/trash/:kind/:id", { schema: purgeSchema }, c.purge);
};
