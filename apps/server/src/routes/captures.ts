import type { FastifyPluginAsync } from "fastify";
import { PhotoType } from "@sonic/shared";
import { requireAuth } from "../auth.js";
import { db } from "../db/index.js";
import { storage } from "../storage/index.js";
import { enqueueRecognize } from "../queue.js";
import { serializeCapture, promoteToCatalog } from "../services/captures.js";

export const captureRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  // Create a capture from uploaded photos, then enqueue recognition.
  app.post("/captures", async (req, reply) => {
    let barcodeHint: string | null = null;
    const photos: { type: string; buffer: Buffer }[] = [];

    for await (const part of req.parts()) {
      if (part.type === "field" && part.fieldname === "barcodeHint") {
        barcodeHint = String(part.value);
      } else if (part.type === "file") {
        const type = PhotoType.safeParse(part.fieldname);
        if (!type.success) continue; // ignore unexpected fields
        photos.push({ type: type.data, buffer: await part.toBuffer() });
      }
    }
    if (photos.length === 0) return reply.code(400).send({ error: "no photos" });

    const capture = await db
      .insertInto("capture")
      .values({ status: "processing", barcode_hint: barcodeHint })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const p of photos) {
      const key = `captures/${capture.id}/${p.type}.jpg`;
      await storage.put(key, p.buffer, "image/jpeg");
      await db
        .insertInto("capture_photo")
        .values({ capture_id: capture.id, type: p.type as any, storage_key: key })
        .execute();
    }

    await enqueueRecognize({ captureId: capture.id });
    return reply.code(201).send(await serializeCapture(capture.id));
  });

  // Pending Approval queue (optionally filtered by status).
  app.get<{ Querystring: { status?: string } }>("/captures", async (req) => {
    let q = db.selectFrom("capture").select("id");
    if (req.query.status) q = q.where("status", "=", req.query.status as any);
    else q = q.where("status", "in", ["pending_single", "pending_multiple", "pending_nomatch"]);
    const rows = await q.orderBy("created_at", "desc").execute();
    return Promise.all(rows.map((r) => serializeCapture(r.id)));
  });

  app.get<{ Params: { id: string } }>("/captures/:id", async (req) => {
    return serializeCapture(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/captures/:id/approve", async (req) => {
    return promoteToCatalog(req.params.id, req.body ?? {});
  });

  // Bulk-approve: only pending_single captures are eligible.
  app.post("/captures/approve-bulk", async (req, reply) => {
    const ids = (req.body as { captureIds?: string[] })?.captureIds ?? [];
    if (!ids.length) return reply.code(400).send({ error: "captureIds required" });

    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const cap = await db
        .selectFrom("capture")
        .select(["id", "status"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!cap) skipped.push({ id, reason: "not found" });
      else if (cap.status !== "pending_single")
        skipped.push({ id, reason: `not eligible (${cap.status})` });
      else {
        await promoteToCatalog(id, {});
        approved.push(id);
      }
    }
    return { approved, skipped };
  });

  // Resolve a multiple/no-match capture (choose candidate or hand-enter).
  app.post<{ Params: { id: string } }>("/captures/:id/resolve", async (req) => {
    return promoteToCatalog(req.params.id, req.body ?? {});
  });
};
