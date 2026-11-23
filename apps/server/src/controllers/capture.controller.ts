import type { FastifyReply, FastifyRequest } from "fastify";
import { MediaKind, PhotoType } from "@sonic/shared";
import { z } from "zod";
import { BadRequestError } from "@sonic/core/errors";
import type {
  approveBulkSchema,
  approveCaptureSchema,
  getCaptureSchema,
  listCapturesSchema,
  reextractSchema,
  rematchBulkSchema,
  rematchSchema,
  resolveCaptureSchema,
} from "../schemas/capture.schema.js";
import type { ZodRequest } from "../schemas/common.js";
import type { CaptureService } from "@sonic/core/services/capture.service";

export class CaptureController {
  constructor(private readonly captures: CaptureService) {}

  /**
   * Multipart upload: one file field per photo type, plus optional `media`
   * ("vinyl" | "cd"), `barcodeHint` and `captureId` (client-chosen UUID that
   * makes retries idempotent). 201 when created, 200 when `captureId` already existed.
   */
  create = async (req: FastifyRequest, reply: FastifyReply) => {
    let barcodeHint: string | null = null;
    let media: MediaKind | null = null;
    let captureId: string | undefined;
    // Keyed by type: a repeated field replaces the earlier photo of that type.
    const photos = new Map<PhotoType, Buffer>();

    for await (const part of req.parts()) {
      if (part.type === "field" && part.fieldname === "barcodeHint") {
        barcodeHint = String(part.value).trim() || null;
      } else if (part.type === "field" && part.fieldname === "media") {
        const m = MediaKind.safeParse(String(part.value).trim().toLowerCase());
        if (!m.success) throw new BadRequestError('media must be "vinyl" or "cd"');
        media = m.data;
      } else if (part.type === "field" && part.fieldname === "captureId") {
        const id = z.string().uuid().safeParse(String(part.value).trim());
        if (!id.success) throw new BadRequestError("captureId must be a UUID");
        captureId = id.data;
      } else if (part.type === "file") {
        const type = PhotoType.safeParse(part.fieldname);
        if (!type.success) {
          await part.toBuffer(); // drain so the stream can continue
          continue;
        }
        photos.set(type.data, await part.toBuffer());
      }
    }

    const { capture, created } = await this.captures.create(req.authUser.id, { photos, media, barcodeHint, captureId });
    req.log.info(
      { captureId: capture.id, photos: capture.photos.length, media, barcodeHint, created },
      created ? "capture created" : "capture already existed (retry)",
    );
    return reply.code(created ? 201 : 200).send(capture);
  };

  list = async (req: ZodRequest<typeof listCapturesSchema>) => {
    return this.captures.list(req.authUser.id, req.query);
  };

  get = async (req: ZodRequest<typeof getCaptureSchema>) => {
    return this.captures.get(req.authUser.id, req.params.id);
  };

  /** Approve (or resolve) a capture, optionally choosing a candidate and adding copy details. */
  approve = async (req: ZodRequest<typeof approveCaptureSchema>) => {
    return this.captures.approve(req.authUser.id, req.params.id, req.body ?? {});
  };

  /** Approve with owner-confirmed data (no source match). */
  resolve = async (req: ZodRequest<typeof resolveCaptureSchema>) => {
    return this.captures.resolveManual(req.authUser.id, req.params.id, req.body);
  };

  reextract = async (req: ZodRequest<typeof reextractSchema>, reply: FastifyReply) => {
    const capture = await this.captures.reextract(req.authUser.id, req.params.id);
    req.log.info({ captureId: capture.id }, "capture sent back to the extractor");
    return reply.code(202).send(capture);
  };

  rematch = async (req: ZodRequest<typeof rematchSchema>, reply: FastifyReply) => {
    const capture = await this.captures.rematch(req.authUser.id, req.params.id);
    req.log.info({ captureId: capture.id }, "capture sent back to the matcher");
    return reply.code(202).send(capture);
  };

  rematchBulk = async (req: ZodRequest<typeof rematchBulkSchema>, reply: FastifyReply) => {
    const result = await this.captures.rematchBulk(req.authUser.id, req.body.captureIds);
    req.log.info({ queued: result.queued.length, skipped: result.skipped.length }, "captures sent back to the matcher");
    return reply.code(202).send(result);
  };

  approveBulk = async (req: ZodRequest<typeof approveBulkSchema>) => {
    return this.captures.approveBulk(req.authUser.id, req.body.captureIds);
  };
}
