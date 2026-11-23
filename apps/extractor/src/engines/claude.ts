import Anthropic from "@anthropic-ai/sdk";
import {
  type ExtractionEngine,
  type ExtractionResult,
  type PhotoInput,
  parseVisionOutput,
  SYSTEM_PROMPT,
  userPrompt,
  VISION_OUTPUT_SCHEMA,
} from "./types.js";

/**
 * Claude vision with structured outputs: the response is constrained to
 * VISION_OUTPUT_SCHEMA, then validated again with zod before it's stored.
 * Server-side refusal fallbacks are on ("default" routing), so a rare
 * safety-classifier decline is retried on a fallback model in the same call.
 */
export class ClaudeEngine implements ExtractionEngine {
  readonly name = "claude" as const;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    // With a configured key, use only it: otherwise the SDK also picks up
    // ANTHROPIC_AUTH_TOKEN from the shell and sends it as a Bearer header too,
    // and a stale token there fails every request with "Invalid bearer token".
    // No key → the SDK resolves ANTHROPIC_API_KEY / auth token / `ant` profile itself.
    this.client = new Anthropic(apiKey ? { apiKey, authToken: null } : {});
  }

  async extract(photos: PhotoInput[]): Promise<ExtractionResult> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Reading printed text is not a hard reasoning task; medium keeps cost/latency down.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: VISION_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...photos.map((p) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: p.mediaType, data: p.data.toString("base64") },
            })),
            { type: "text" as const, text: userPrompt(photos) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined to read these photos (${response.stop_details?.category ?? "no category"})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude's response was cut off (max_tokens)");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("Claude returned no text block");
    return parseVisionOutput(text.text);
  }
}
