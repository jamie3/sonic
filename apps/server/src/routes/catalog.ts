import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CatalogController } from "../controllers/catalog.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  catalogFacetsSchema,
  getCatalogEntrySchema,
  listTagsSchema,
  searchCatalogSchema,
  updateCatalogEntrySchema,
} from "../schemas/catalog.schema.js";

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  const c = new CatalogController(app.services.catalog);
  app.addHook("preHandler", requireAuth);

  app.get("/catalog/search", { schema: searchCatalogSchema }, c.search);
  // Registered before /catalog/:id so "facets" isn't taken as an id.
  app.get("/catalog/facets", { schema: catalogFacetsSchema }, c.facets);
  app.get("/catalog/:id", { schema: getCatalogEntrySchema }, c.get);
  app.patch("/catalog/:id", { schema: updateCatalogEntrySchema }, c.update);
  app.get("/tags", { schema: listTagsSchema }, c.tags);
};
