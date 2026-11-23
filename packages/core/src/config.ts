/** Centralized, validated environment config. */
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the .env file from the monorepo root (packages/core/src → three levels up).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// Base for a relative IMAGE_DIR. Kept at apps/server (where it has always
// resolved) so existing local photo directories are still found.
const imageBaseDir = path.join(rootDir, "apps/server");
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3005),

  JWT_SECRET: z.string().min(16),
  // Better Auth: signs session cookies. Defaults to a key derived from JWT_SECRET.
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  // Public URL of the API/web app (origin checks, links). Defaults to http://localhost:PORT.
  BETTER_AUTH_URL: z.string().url().optional(),

  // Built web app to serve alongside the API. Defaults to the sibling workspace
  // build for local `pnpm build`; the Docker image sets it to /app/public.
  WEB_DIR: z.string().default(path.join(rootDir, "apps/web/dist")),

  STORAGE_DRIVER: z.enum(["disk", "s3"]).default("disk"),
  // A relative path resolves against apps/server, so every process (API,
  // matcher, extractor) finds the same files no matter which directory it was
  // started from.
  IMAGE_DIR: z
    .string()
    .default("/data/images")
    .transform((dir) => (path.isAbsolute(dir) ? dir : path.resolve(imageBaseDir, dir))),

  // Requests per minute per client IP across /api (login has its own, stricter limit).
  API_RATE_LIMIT: z.coerce.number().int().min(10).default(600),
  // Set when the API runs behind a reverse proxy (nginx, Caddy, a load
  // balancer) so rate limits key on the real client IP from X-Forwarded-For.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Days an item stays in the trash before the purge job deletes it for good.
  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  // Serve OpenAPI docs at /api/docs. Defaults to on outside production.
  API_DOCS: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  DISCOGS_TOKEN: z.string().optional(),
  // Where matching looks releases up: the local data-dump copy (`pnpm
  // discogs:import`), the Discogs API (needs DISCOGS_TOKEN), or off. "auto" =
  // local if imported, else API if a token is set, else off.
  DISCOGS_SOURCE: z.enum(["auto", "local", "api", "off"]).default("auto"),
  // When the local copy finds nothing, search the Discogs API too (needs
  // DISCOGS_TOKEN; rate-limited, so only used for misses).
  DISCOGS_API_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Optional separate database for the (large) local Discogs copy; defaults to DATABASE_URL.
  DISCOGS_DATABASE_URL: z.string().url().optional(),
  DISCOGS_USER_AGENT: z.string().default("Sonic/0.1"),

  VISION_DRIVER: z.enum(["claude", "ollama"]).default("claude"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().optional(),
  OLLAMA_VISION_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

const parsed = Env.parse(process.env);
export const config = {
  ...parsed,
  API_DOCS: parsed.API_DOCS ?? parsed.NODE_ENV !== "production",
};
export type AppConfig = typeof config;
