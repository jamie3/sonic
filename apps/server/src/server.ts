import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { NoResultError } from "kysely";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { captureRoutes } from "./routes/captures.js";
import { catalogRoutes } from "./routes/catalog.js";
import { imageRoutes } from "./routes/images.js";

export async function buildServer() {
  const app = Fastify({
    logger:
      config.NODE_ENV === "production"
        ? true
        : {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss.l",
                ignore: "pid,hostname",
              },
            },
          },
  });

  // Map "expected a row but got none" into a clean 404 instead of a 500.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof NoResultError) {
      req.log.info({ url: req.url }, "resource not found");
      return reply.code(404).send({ error: "not found" });
    }
    req.log.error({ err }, "request error");
    return reply.send(err); // preserves status (e.g. validation 400) or 500
  });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 6 } });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(captureRoutes);
  await app.register(catalogRoutes);
  await app.register(imageRoutes);

  return app;
}

export async function serve() {
  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}
