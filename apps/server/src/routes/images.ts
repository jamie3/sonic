import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth.js";
import { storage } from "../storage/index.js";

/** Serves stored photos behind auth. Wildcard captures the full storage key. */
export const imageRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { "*": string } }>(
    "/images/*",
    { preHandler: requireAuth },
    async (req, reply) => {
      const key = req.params["*"];
      try {
        const stream = await storage.getStream(key);
        reply.type("image/jpeg");
        return reply.send(stream);
      } catch {
        return reply.code(404).send({ error: "not found" });
      }
    },
  );
};
