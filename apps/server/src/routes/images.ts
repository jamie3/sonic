import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { ImageController } from "../controllers/image.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getImageSchema } from "../schemas/image.schema.js";

/** Serves stored photos behind auth (cookie fallback lets <img> authenticate). */
export const imageRoutes: FastifyPluginAsyncZod = async (app) => {
  const c = new ImageController(app.services.images);
  app.get("/images/*", { schema: getImageSchema, preHandler: requireAuth }, c.get);
};
