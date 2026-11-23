import { config } from "../config.js";
import { ClaudeEngine } from "./claude.js";
import { OllamaEngine } from "./ollama.js";
import { TesseractEngine } from "./tesseract.js";
import type { ExtractionEngine } from "./types.js";

export function createEngine(): ExtractionEngine {
  switch (config.engine) {
    case "claude":
      return new ClaudeEngine(config.model, config.anthropicApiKey);
    case "ollama":
      return new OllamaEngine(config.ollamaUrl, config.model);
    case "tesseract":
      return new TesseractEngine();
  }
}

export type { ExtractionEngine, PhotoInput } from "./types.js";
