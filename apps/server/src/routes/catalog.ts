import type { FastifyPluginAsync } from "fastify";
import { CatalogSearchQuery } from "@sonic/shared";
import { requireAuth } from "../auth.js";
import { db } from "../db/index.js";
import { serializeCatalogEntry } from "../services/captures.js";

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/catalog/search", async (req, reply) => {
    const parsed = CatalogSearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query" });
    const q = parsed.data;

    let base = db
      .selectFrom("catalog_entry as ce")
      .innerJoin("release as r", "r.id", "ce.release_id");

    if (q.q) base = base.where((eb) =>
      eb.or([eb("r.artist", "ilike", `%${q.q}%`), eb("r.title", "ilike", `%${q.q}%`)]),
    );
    if (q.artist) base = base.where("r.artist", "ilike", `%${q.artist}%`);
    if (q.label) base = base.where("r.label", "ilike", `%${q.label}%`);
    if (q.year) base = base.where("r.year", "=", q.year);
    if (q.location) base = base.where("ce.location", "ilike", `%${q.location}%`);
    if (q.condition) base = base.where("ce.condition", "=", q.condition);

    const total = await base
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirst();

    const rows = await base
      .select("ce.id as id")
      .orderBy("ce.approved_at", "desc")
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();

    const items = await Promise.all(rows.map((r) => serializeCatalogEntry(r.id)));
    return {
      items,
      total: Number(total?.count ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.get<{ Params: { id: string } }>("/catalog/:id", async (req) => {
    return serializeCatalogEntry(req.params.id);
  });
};
