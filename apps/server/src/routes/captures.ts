import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CaptureController } from "../controllers/capture.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  approveBulkSchema,
  approveCaptureSchema,
  createCaptureSchema,
  getCaptureSchema,
  listCapturesSchema,
  reextractSchema,
  rematchBulkSchema,
  rematchSchema,
  resolveCaptureSchema,
} from "../schemas/capture.schema.js";

export const captureRoutes: FastifyPluginAsyncZod = async (app) => {
  const c = new CaptureController(app.services.captures);
  app.addHook("preHandler", requireAuth);

  app.post("/captures", { schema: createCaptureSchema }, c.create);
  app.get("/captures", { schema: listCapturesSchema }, c.list);
  app.get("/captures/:id", { schema: getCaptureSchema }, c.get);
  app.post("/captures/approve-bulk", { schema: approveBulkSchema }, c.approveBulk);
  app.post("/captures/match-bulk", { schema: rematchBulkSchema }, c.rematchBulk);
  app.post("/captures/:id/approve", { schema: approveCaptureSchema }, c.approve);
  app.post("/captures/:id/resolve", { schema: resolveCaptureSchema }, c.resolve);
  app.post("/captures/:id/extract", { schema: reextractSchema }, c.reextract);
  app.post("/captures/:id/match", { schema: rematchSchema }, c.rematch);
};
