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
 * Local vision model via Ollama (e.g. qwen2.5vl). Free and private; less
 * accurate on stylised artwork and small print. Ollama's `format` accepts a
 * JSON schema, so the reply is shaped like Claude's and validated the same way.
 */
export class OllamaEngine implements ExtractionEngine {
  readonly name = "ollama" as const;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async extract(photos: PhotoInput[]): Promise<ExtractionResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5 * 60_000),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: VISION_OUTPUT_SCHEMA,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: userPrompt(photos),
            images: photos.map((p) => p.data.toString("base64")),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { message?: { content?: string } };
    if (!body.message?.content) throw new Error("Ollama returned no content");
    return parseVisionOutput(body.message.content);
  }
}
