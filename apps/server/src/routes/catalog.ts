import type { FastifyPluginAsync } from "fastify";
import type { Updateable } from "kysely";
import { CatalogSearchQuery, UpdateCatalogEntry } from "@sonic/shared";
import { requireAuth } from "../auth.js";
import { db } from "../db/index.js";
import type { CatalogEntryTable, ReleaseTable } from "../db/types.js";
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

  // Update editable columns of a catalog entry and/or its release. All fields
  // are optional; only those present are written. `notes: null` clears it.
  app.patch<{ Params: { id: string } }>("/catalog/:id", async (req, reply) => {
    const parsed = UpdateCatalogEntry.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const d = parsed.data;
    const id = req.params.id;

    const entry = await db
      .selectFrom("catalog_entry")
      .select("release_id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!entry) return reply.code(404).send({ error: "not found" });

    const ce: Updateable<CatalogEntryTable> = {};
    if (d.condition !== undefined) ce.condition = d.condition;
    if (d.location !== undefined) ce.location = d.location || null;
    if (d.purchasePrice !== undefined) ce.purchase_price = d.purchasePrice;
    if (d.purchaseDate !== undefined) ce.purchase_date = d.purchaseDate || null;
    if (d.notes !== undefined) ce.notes = d.notes || null;
    if (Object.keys(ce).length) {
      await db.updateTable("catalog_entry").set(ce).where("id", "=", id).execute();
    }

    if (d.release) {
      const rd = d.release;
      const r: Updateable<ReleaseTable> = {};
      if (rd.artist !== undefined) r.artist = rd.artist;
      if (rd.title !== undefined) r.title = rd.title;
      if (rd.label !== undefined) r.label = rd.label || null;
      if (rd.catalogNumber !== undefined) r.catalog_number = rd.catalogNumber || null;
      if (rd.barcode !== undefined) r.barcode = rd.barcode || null;
      if (rd.year !== undefined) r.year = rd.year;
      if (rd.country !== undefined) r.country = rd.country || null;
      if (rd.format !== undefined) r.format = rd.format || null;
      if (rd.genres !== undefined) r.genres = rd.genres;
      if (rd.styles !== undefined) r.styles = rd.styles;
      if (rd.coverUrl !== undefined) r.cover_url = rd.coverUrl || null;
      if (Object.keys(r).length) {
        await db.updateTable("release").set(r).where("id", "=", entry.release_id).execute();
      }
    }

    return serializeCatalogEntry(id);
  });
};
