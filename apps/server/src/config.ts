/** Centralized, validated environment config. */
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the .env file from the monorepo root (three levels up from src/).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3005),

  JWT_SECRET: z.string().min(16),
  AUTH_USERNAME: z.string().min(1),
  AUTH_PASSWORD_HASH: z.string().min(1),

  STORAGE_DRIVER: z.enum(["disk", "s3"]).default("disk"),
  IMAGE_DIR: z.string().default("/data/images"),

  DISCOGS_TOKEN: z.string().optional(),
  DISCOGS_USER_AGENT: z.string().default("Sonic/0.1"),

  VISION_DRIVER: z.enum(["claude", "ollama"]).default("claude"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().optional(),
  OLLAMA_VISION_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

export const config: Config = Env.parse(process.env);
