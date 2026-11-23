import type { FastifyRequest } from "fastify";
import type {
  getCatalogEntrySchema,
  searchCatalogSchema,
  updateCatalogEntrySchema,
} from "../schemas/catalog.schema.js";
import type { ZodRequest } from "../schemas/common.js";
import type { CatalogService } from "@sonic/core/services/catalog.service";

export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  search = async (req: ZodRequest<typeof searchCatalogSchema>) => {
    return this.catalog.search(req.authUser.id, req.query);
  };

  get = async (req: ZodRequest<typeof getCatalogEntrySchema>) => {
    return this.catalog.get(req.authUser.id, req.params.id);
  };

  facets = async (req: FastifyRequest) => {
    return this.catalog.facets(req.authUser.id);
  };

  tags = async (req: FastifyRequest) => {
    return this.catalog.listTags(req.authUser.id);
  };

  update = async (req: ZodRequest<typeof updateCatalogEntrySchema>) => {
    return this.catalog.update(req.authUser.id, req.params.id, req.body);
  };
}
