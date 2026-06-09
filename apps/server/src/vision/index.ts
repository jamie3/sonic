/**
 * Vision seam (architecture.md §4.5 / §6 stage 3). Extracts structured release
 * fields from photos when barcode + OCR fail. Claude now; local Ollama vision
 * model selectable via VISION_DRIVER.
 */
import { config } from "../config.js";

export interface ExtractedFields {
  artist?: string;
  title?: string;
  label?: string;
  catalogNumber?: string;
}

export interface VisionImage {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png";
}

export interface VisionExtractor {
  extract(images: VisionImage[]): Promise<ExtractedFields>;
}

const PROMPT =
  "You are reading photographs of a vinyl record sleeve and label. " +
  "Extract the artist, release title, record label, and catalog number. " +
  "Respond with JSON only: {artist, title, label, catalogNumber}. " +
  "Use null for any field you cannot read confidently.";

/** Claude Vision via the Anthropic SDK. */
class ClaudeVision implements VisionExtractor {
  constructor(private apiKey: string) {}

  async extract(images: VisionImage[]): Promise<ExtractedFields> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const msg = await client.messages.create({
      // Sonnet balances cost/accuracy for label reading; Haiku
      // (claude-haiku-4-5-20251001) is cheaper if accuracy holds up.
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType,
                data: img.data.toString("base64"),
              },
            })),
            { type: "text" as const, text: PROMPT },
          ],
        },
      ],
    });
    const text = msg.content.find((b) => b.type === "text");
    return parseFields(text && "text" in text ? text.text : "{}");
  }
}

/** Local Ollama vision model (e.g. qwen2-vl) — same contract, no API cost. */
class OllamaVision implements VisionExtractor {
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async extract(images: VisionImage[]): Promise<ExtractedFields> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: PROMPT,
        images: images.map((i) => i.data.toString("base64")),
        format: "json",
        stream: false,
      }),
    });
    const json = (await res.json()) as { response?: string };
    return parseFields(json.response ?? "{}");
  }
}

function parseFields(raw: string): ExtractedFields {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return {
      artist: str(o.artist),
      title: str(o.title),
      label: str(o.label),
      catalogNumber: str(o.catalogNumber),
    };
  } catch {
    return {};
  }
}

function createVision(): VisionExtractor {
  if (config.VISION_DRIVER === "ollama") {
    return new OllamaVision(
      config.OLLAMA_URL ?? "http://localhost:11434",
      config.OLLAMA_VISION_MODEL ?? "qwen2-vl",
    );
  }
  if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required for VISION_DRIVER=claude");
  return new ClaudeVision(config.ANTHROPIC_API_KEY);
}

export const vision: VisionExtractor = createVision();
