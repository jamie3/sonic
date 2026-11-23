import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { NoResultError } from "kysely";
import { z } from "zod";
import { config } from "@sonic/core/config";
import { db } from "@sonic/core/db";
import { AppError, TooManyRequestsError } from "@sonic/core/errors";
import { servicesPlugin } from "./plugins/services.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { enqueueExtract, enqueueRecognize } from "@sonic/core/queue";
import { accountRoutes } from "./routes/account.js";
import { betterAuthRoutes } from "./routes/better-auth.js";
import { TRUSTED_ORIGINS } from "./auth.js";
import { captureRoutes } from "./routes/captures.js";
import { catalogRoutes } from "./routes/catalog.js";
import { imageRoutes } from "./routes/images.js";
import { trashRoutes } from "./routes/trash.js";
import { resolveMetadataSource } from "@sonic/core/metadata";
import { createServices, type Services } from "@sonic/core/services";
import { storage } from "@sonic/core/storage";

/** Fastify's names for request parts → the wording used in `{ error }`. */
const PART_NAMES: Record<string, string> = { querystring: "query", params: "path params" };

export async function buildServer(
  services: Services = createServices({ db, storage, queue: { enqueueExtract, enqueueRecognize } }),
) {
  const app = Fastify({
    // Behind a reverse proxy, take the client IP from X-Forwarded-For (rate limits key on it).
    trustProxy: config.TRUST_PROXY,
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
  }).withTypeProvider<ZodTypeProvider>();

  // Route schemas are zod: Fastify validates requests and serializes responses
  // with them (see schemas/).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Every error leaves as `{ error }` JSON:
  // - schema validation failures → 400 with the zod issues
  // - AppError (thrown by services) → its status and message
  // - Kysely "expected a row but got none" → 404
  // - other client errors Fastify raises (bad JSON, too large, …) → their status
  // - anything else → logged, generic 500 (no internals leaked)
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const part = err.validationContext ?? "request";
      return reply.code(400).send({
        error: `invalid ${PART_NAMES[part] ?? part}`,
        issues: err.validation.map((v) => ({
          path: v.instancePath || "/",
          message: v.message,
        })),
      });
    }
    if (isResponseSerializationError(err)) {
      // A handler returned data that doesn't match its response schema: a bug.
      req.log.error({ err, issues: err.cause.issues }, "response failed schema validation");
      return reply.code(500).send({ error: "internal server error" });
    }
    if (err instanceof AppError) {
      const retryAfter = err instanceof TooManyRequestsError ? (err as TooManyRequestsError).retryAfterSeconds : undefined;
      if (retryAfter) reply.header("retry-after", String(retryAfter));
      if (err.statusCode >= 500) req.log.error({ err }, "request error");
      else req.log.info({ url: req.url, status: err.statusCode, msg: err.message }, "request rejected");
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof NoResultError) {
      req.log.info({ url: req.url }, "resource not found");
      return reply.code(404).send({ error: "not found" });
    }
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status < 500) {
      req.log.info({ url: req.url, status, msg: err.message }, "request rejected");
      return reply.code(status).send({ error: err.message });
    }
    req.log.error({ err }, "request error");
    return reply.code(500).send({ error: "internal server error" });
  });

  // Fastify-native DI: services live on the instance as `app.services`.
  await app.register(servicesPlugin, { services });

  if (config.API_DOCS) await app.register(swaggerPlugin);

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 6 } });

  // Everything API lives under /api so it can't collide with SPA routes.
  await app.register(
    async (api) => {
      // Per-IP request cap for every API route (static web files aren't
      // counted). Generous: a catalog page loads many photos through
      // /api/images. Routes can set a stricter `config.rateLimit` (login does).
      await api.register(rateLimit, {
        max: config.API_RATE_LIMIT,
        timeWindow: "1 minute",
        allowList: (req) => req.url === "/api/health",
        errorResponseBuilder: (_req, ctx) => {
          const seconds = Math.ceil(ctx.ttl / 1000);
          return new TooManyRequestsError(`too many requests — try again in ${seconds}s`, seconds);
        },
      });
      // CSRF backstop: the API authenticates with a session cookie, so refuse
      // state-changing requests sent from another site's page. (The cookie is
      // also SameSite=Lax.) Requests without an Origin — the mobile app, curl —
      // aren't browser cross-site requests and pass. Better Auth checks its
      // own /api/auth routes.
      api.addHook("onRequest", async (req, reply) => {
        if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
        if (req.url.startsWith("/api/auth/")) return;
        const origin = req.headers.origin;
        if (!origin) return;
        const self = `${req.protocol}://${req.headers.host}`;
        if (origin === self || TRUSTED_ORIGINS.includes(origin)) return;
        req.log.warn({ origin, url: req.url }, "cross-site request refused");
        return reply.code(403).send({ error: "cross-site request refused" });
      });
      api.get(
        "/health",
        {
          schema: {
            tags: ["system"],
            summary: "Health check",
            response: { 200: z.object({ ok: z.literal(true) }) },
          },
        },
        async () => ({ ok: true as const }),
      );
      // Accounts & sessions (Better Auth), then the signed-in user's profile + invites.
      await api.register(betterAuthRoutes);
      await api.register(accountRoutes);
      await api.register(captureRoutes);
      await api.register(catalogRoutes);
      await api.register(imageRoutes);
      await api.register(trashRoutes);
    },
    { prefix: "/api" },
  );

  await registerWebApp(app);

  return app;
}

/**
 * Serve the built web app (apps/web/dist) from the same origin as the API, with
 * an SPA fallback: unknown non-API GETs that want HTML get index.html. Skipped
 * when no build is present (e.g. dev, where Vite serves the UI and proxies /api).
 */
async function registerWebApp(app: FastifyInstance<any, any, any, any, any>) {
  const root = path.resolve(config.WEB_DIR);
  if (!existsSync(path.join(root, "index.html"))) {
    app.log.info({ root }, "no web build found; serving API only");
    return;
  }

  await app.register(fastifyStatic, { root, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    const wantsPage =
      req.method === "GET" && !req.url.startsWith("/api/") && req.headers.accept?.includes("text/html");
    if (wantsPage) return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send({ error: "not found" });
  });
  app.log.info({ root }, "serving web app");
}

export async function serve() {
  // Same Discogs sources as the matcher (local copy, then the API): used to
  // fetch a release's full details (tracklist) when it's approved.
  const metadata = await resolveMetadataSource();
  const app = await buildServer(
    createServices({
      db,
      storage,
      queue: { enqueueExtract, enqueueRecognize },
      metadata: metadata.source,
      metadataFallback: metadata.fallback,
    }),
  );
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}
