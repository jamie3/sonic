import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodRequest } from "../schemas/common.js";
import type {
  purgeSchema,
  restoreSchema,
  trashCaptureSchema,
  trashEntrySchema,
} from "../schemas/trash.schema.js";
import type { TrashService } from "@sonic/core/services/trash.service";

export class TrashController {
  constructor(private readonly trash: TrashService) {}

  trashEntry = async (req: ZodRequest<typeof trashEntrySchema>, reply: FastifyReply) => {
    await this.trash.trashEntry(req.authUser.id, req.params.id);
    req.log.info({ entryId: req.params.id }, "catalog entry moved to trash");
    return reply.code(204).send();
  };

  trashCapture = async (req: ZodRequest<typeof trashCaptureSchema>, reply: FastifyReply) => {
    await this.trash.trashCapture(req.authUser.id, req.params.id);
    req.log.info({ captureId: req.params.id }, "capture moved to trash");
    return reply.code(204).send();
  };

  list = async (req: FastifyRequest) => this.trash.list(req.authUser.id);

  restore = async (req: ZodRequest<typeof restoreSchema>, reply: FastifyReply) => {
    await this.trash.restore(req.authUser.id, req.params.kind, req.params.id);
    req.log.info(req.params, "restored from trash");
    return reply.code(204).send();
  };

  purge = async (req: ZodRequest<typeof purgeSchema>, reply: FastifyReply) => {
    await this.trash.purge(req.authUser.id, req.params.kind, req.params.id);
    req.log.info(req.params, "permanently deleted from trash");
    return reply.code(204).send();
  };

  empty = async (req: FastifyRequest) => this.trash.emptyTrash(req.authUser.id);
}
