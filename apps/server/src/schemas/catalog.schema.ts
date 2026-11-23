import {
  CatalogFacets,
  CatalogEntry,
  CatalogSearchQuery,
  CatalogSearchResult,
  TagSummary,
  UpdateCatalogEntry,
} from "@sonic/shared";
import { z } from "zod";
import { bearerAuth, errors, IdParams } from "./common.js";

export const searchCatalogSchema = {
  tags: ["catalog"],
  summary: "Search the catalog",
  description:
    "Paged, newest first. `q` matches artist or title. Exact, case-insensitive: `tag`, `label`, `country`. Release year: `year` (exact) or `yearFrom` / `yearTo` (inclusive range). Filters combine (AND).",
  security: bearerAuth,
  querystring: CatalogSearchQuery,
  response: { 200: CatalogSearchResult, ...errors(400, 401) },
};

export const getCatalogEntrySchema = {
  tags: ["catalog"],
  summary: "Get a catalog entry",
  security: bearerAuth,
  params: IdParams,
  response: { 200: CatalogEntry, ...errors(400, 401, 404) },
};

export const updateCatalogEntrySchema = {
  tags: ["catalog"],
  summary: "Update a catalog entry",
  description: "Only fields present are written. `tags` replaces the entry's whole tag set.",
  security: bearerAuth,
  params: IdParams,
  body: UpdateCatalogEntry,
  response: { 200: CatalogEntry, ...errors(400, 401, 404) },
};

export const catalogFacetsSchema = {
  tags: ["catalog"],
  summary: "Filter options",
  description:
    "Labels, countries and release years in the signed-in user's catalog (non-trashed), with how many entries have each — for building filters. Also counts entries missing each field.",
  security: bearerAuth,
  response: { 200: CatalogFacets, ...errors(401) },
};

export const listTagsSchema = {
  tags: ["catalog"],
  summary: "List tags",
  description: "Tags in use, with how many catalog entries carry each, sorted by name.",
  security: bearerAuth,
  response: { 200: z.array(TagSummary), ...errors(401) },
};
