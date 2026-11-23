import type { FastifyReply } from "fastify";
import type { getImageSchema } from "../schemas/image.schema.js";
import type { ZodRequest } from "../schemas/common.js";
import type { ImageService } from "@sonic/core/services/image.service";

export class ImageController {
  constructor(private readonly images: ImageService) {}

  /**
   * Wildcard param carries the full storage key, e.g. captures/<id>/front.jpg.
   * The 200 body is a binary stream (no response schema), so the reply is
   * untyped here.
   */
  get = async (req: ZodRequest<typeof getImageSchema>, reply: FastifyReply) => {
    const stream = await this.images.open(req.authUser.id, req.params["*"]);
    // Keys are unique per upload attempt and never rewritten, so clients may
    // cache forever ("private": the response is behind auth).
    return reply
      .type("image/jpeg")
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(stream);
  };
}
