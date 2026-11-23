/**
 * Extractor settings. Importing the server's config first loads the repo-root
 * env file and validates the shared settings (DATABASE_URL, storage, keys).
 */
import { config as server } from "@sonic/core/config";
import { z } from "zod";

const Env = z.object({
  /** Which engine reads the photos. */
  EXTRACTOR_ENGINE: z.enum(["claude", "ollama", "tesseract"]).default("claude"),
  /** Model override; defaults per engine (see below). */
  EXTRACTOR_MODEL: z.string().optional(),
  /** Captures processed at once. */
  EXTRACTOR_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

const env = Env.parse(process.env);

export const config = {
  engine: env.EXTRACTOR_ENGINE,
  model:
    env.EXTRACTOR_MODEL ??
    (env.EXTRACTOR_ENGINE === "claude"
      ? "claude-opus-5-5"
      : env.EXTRACTOR_ENGINE === "ollama"
        ? (server.OLLAMA_VISION_MODEL ?? "qwen2.5vl")
        : "eng"),
  concurrency: env.EXTRACTOR_CONCURRENCY,
  anthropicApiKey: server.ANTHROPIC_API_KEY,
  ollamaUrl: server.OLLAMA_URL ?? "http://localhost:11434",
};
