import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { captureRoutes } from "./routes/captures.js";
import { catalogRoutes } from "./routes/catalog.js";
import { imageRoutes } from "./routes/images.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

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
