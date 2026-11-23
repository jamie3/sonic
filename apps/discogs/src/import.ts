/**
 * Import the Discogs XML data dumps into a local, indexed Postgres copy.
 *
 *   pnpm discogs:import                      # every dump found in the repo root
 *   pnpm discogs:import --only releases      # just one entity
 *   pnpm discogs:import --dir data/discogs   # dumps elsewhere
 *   pnpm discogs:import --limit 50000        # quick trial on the first N records
 *
 * Streams each file (plain .xml or .xml.gz) through a SAX parser into
 * Postgres COPY — constant memory — into the `discogs_staging` schema, builds
 * indexes there, then swaps the `discogs_*` tables into `public` in one transaction, so
 * matching never sees a half-loaded copy. Target: DISCOGS_DATABASE_URL if set,
 * else DATABASE_URL.
 */
import { createReadStream, existsSync, openSync, readdirSync, readSync, closeSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import pg from "pg";
import type { SaxesParser } from "saxes";
import { config } from "@sonic/core/config";
import { normalizeBarcode, normalizeCatno } from "@sonic/core/matching/score";
import { type Cell, CopyWriter, json } from "./copy.js";
import {
  artistDisplay,
  artistParser,
  labelParser,
  masterParser,
  releaseParser,
  stripDisambiguation,
  yearOf,
} from "./parse.js";
import { type Entity, IMPORT_INFO_DDL, LIVE, STAGING, TABLES } from "./schema.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTITIES: Entity[] = ["labels", "artists", "masters", "releases"];
const CLOSING: Record<Entity, string> = {
  releases: "</releases>",
  masters: "</masters>",
  artists: "</artists>",
  labels: "</labels>",
};

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = path.resolve(ROOT, flag("dir") ?? ".");
const only = flag("only")?.split(",").map((s) => s.trim()) as Entity[] | undefined;
const limit = flag("limit") ? Number(flag("limit")) : undefined;
const connectionString = process.env.DISCOGS_DATABASE_URL || config.DATABASE_URL;

function findDump(entity: Entity): string | null {
  const files = readdirSync(dir)
    .filter((f) => new RegExp(`^discogs_\\d{8}_${entity}\\.xml(\\.gz)?$`).test(f))
    .sort(); // newest date last
  return files.length ? path.join(dir, files[files.length - 1]!) : null;
}

/** Refuse half-written files (e.g. still downloading/extracting). */
function assertComplete(file: string, entity: Entity) {
  if (file.endsWith(".gz") || limit) return; // gunzip fails loudly on truncation; trials read only the head
  const fd = openSync(file, "r");
  const size = statSync(file).size;
  const buf = Buffer.alloc(Math.min(256, size));
  readSync(fd, buf, 0, buf.length, size - buf.length);
  closeSync(fd);
  if (!buf.toString("utf8").includes(CLOSING[entity])) {
    throw new Error(
      `${path.basename(file)} doesn't end with ${CLOSING[entity]} — it looks incomplete (still copying or extracting?). ` +
        `Wait for it to finish, or pass --limit N for a trial import.`,
    );
  }
}

// ---------- per-entity row emitters ----------
type Writers = Record<string, CopyWriter>;

/**
 * Build the parser for an entity. `tick` is called once per record (for
 * progress / --limit). Note: saxes allows one handler per event, so counting
 * must happen here rather than via another parser.on(...).
 */
function makeEmitter(
  entity: Entity,
  w: Writers,
  tick: () => void,
): { parser: (push: (job: Promise<void>) => void) => SaxesParser } {
  switch (entity) {
    case "releases":
      return {
        parser: (push) =>
          releaseParser((r) => {
            tick();
            if (!r.id || !r.title) return;
            const formats = r.formats
              .map((f) => [f.qty && f.qty !== "1" ? `${f.qty}×${f.name}` : f.name, ...f.descriptions, f.text].filter(Boolean).join(", "))
              .join(" + ");
            push(
              w.discogs_release!.write([
                r.id,
                r.title,
                artistDisplay(r.artists),
                r.artists.map((a) => a.id).filter((x): x is number => x !== null),
                yearOf(r.released),
                r.released,
                r.country,
                r.masterId,
                r.isMain,
                formats || null,
                [...new Set(r.formats.map((f) => f.name).filter(Boolean))],
                r.genres,
                r.styles,
                json(r.tracks.filter((t) => t.title).map((t) => ({ position: t.position, title: t.title, duration: t.duration }))),
                r.dataQuality,
              ]),
            );
            for (const l of r.labels) {
              const catno = l.catno && l.catno.toLowerCase() !== "none" ? l.catno : null;
              push(w.discogs_release_label!.write([r.id, l.id, stripDisambiguation(l.name), catno, catno ? normalizeCatno(catno) || null : null]));
            }
            for (const id of r.identifiers) {
              if (!/^barcode/i.test(id.type)) continue;
              const norm = normalizeBarcode(id.value);
              if (norm.length >= 8) push(w.discogs_release_barcode!.write([r.id, id.value, norm]));
            }
          }),
      };
    case "masters":
      return {
        parser: (push) =>
          masterParser((m) => {
            tick();
            if (!m.id || !m.title) return;
            push(
              w.discogs_master!.write([
                m.id,
                m.mainRelease,
                m.title,
                artistDisplay(m.artists),
                m.artists.map((a) => a.id).filter((x): x is number => x !== null),
                m.year,
                m.genres,
                m.styles,
                json(m.videos.filter((v) => v.src)),
                m.dataQuality,
              ]),
            );
          }),
      };
    case "artists":
      return {
        parser: (push) =>
          artistParser((a) => {
            tick();
            if (!a.id || !a.name) return;
            push(w.discogs_artist!.write([a.id, stripDisambiguation(a.name), a.realname, a.nameVariations, a.dataQuality]));
          }),
      };
    case "labels":
      return {
        parser: (push) =>
          labelParser((l) => {
            tick();
            if (!l.id || !l.name) return;
            push(w.discogs_label!.write([l.id, stripDisambiguation(l.name), l.parentName, l.dataQuality]));
          }),
      };
  }
}

// ---------- import one entity ----------
async function importEntity(pool: pg.Pool, entity: Entity, file: string): Promise<number> {
  assertComplete(file, entity);
  const tables = TABLES[entity];
  const admin = await pool.connect();
  try {
    await admin.query(`create schema if not exists ${STAGING}`);
    for (const t of tables) {
      await admin.query(`drop table if exists ${STAGING}.${t.name}`);
      // UNLOGGED: no WAL during the bulk load (much faster); set LOGGED before swapping in.
      await admin.query(
        `create unlogged table ${STAGING}.${t.name} (${t.columns.map(([c, type]) => `${c} ${type}`).join(", ")})`,
      );
    }
  } finally {
    admin.release();
  }

  const writers: Writers = {};
  for (const t of tables) {
    writers[t.name] = new CopyWriter(await pool.connect(), `${STAGING}.${t.name}`, t.columns.map(([c]) => c));
  }

  const size = statSync(file).size;
  const started = Date.now();
  let records = 0;
  let bytes = 0;
  let pending: Promise<void>[] = [];
  let stop = false;
  const tick = () => {
    records++;
    if (limit && records >= limit) stop = true;
  };
  const parser = makeEmitter(entity, writers, tick).parser((job) => {
    if (!stop || !limit || records <= limit) pending.push(job);
  });

  const raw = createReadStream(file, { highWaterMark: 1 << 20 });
  raw.on("data", (c) => (bytes += (c as Buffer).length));
  const input = file.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  let lastLog = 0;
  try {
    for await (const chunk of input) {
      parser.write((chunk as Buffer).toString("utf8"));
      if (pending.length) {
        await Promise.all(pending);
        pending = [];
      }
      if (Date.now() - lastLog > 10_000) {
        lastLog = Date.now();
        const secs = (Date.now() - started) / 1000;
        const pct = (bytes / size) * 100;
        const eta = bytes ? ((size - bytes) / (bytes / secs) / 60).toFixed(0) : "?";
        console.log(
          `  ${entity}: ${records.toLocaleString()} records · ${pct.toFixed(1)}% · ${(bytes / 1e6 / secs).toFixed(0)} MB/s · ~${eta} min left`,
        );
      }
      if (stop) {
        raw.destroy();
        break;
      }
    }
    if (!stop) parser.close();
    await Promise.all(pending);
    for (const w of Object.values(writers)) await w.end();
  } catch (err) {
    for (const w of Object.values(writers)) w.abort(err as Error);
    throw err;
  }
  console.log(`  ${entity}: loaded ${records.toLocaleString()} records in ${((Date.now() - started) / 60000).toFixed(1)} min; indexing…`);

  // Index the staging tables, then swap them into the live schema atomically.
  const client = await pool.connect();
  try {
    await client.query("set maintenance_work_mem = '1GB'");
    for (const t of tables) {
      const T = `${STAGING}.${t.name}`;
      for (const stmt of t.finalize) {
        const sql = stmt.replaceAll("$T", T);
        try {
          await client.query(sql);
        } catch (err) {
          // Dumps occasionally repeat an id: keep the first copy and retry.
          if (/primary key/i.test(sql) && (err as { code?: string }).code === "23505") {
            console.log(`  ${t.name}: removing duplicate ids…`);
            await client.query(`delete from ${T} a using ${T} b where a.id = b.id and a.ctid > b.ctid`);
            await client.query(sql);
          } else throw err;
        }
      }
      await client.query(`alter table ${T} set logged`);
      await client.query(`analyze ${T}`);
    }
    await client.query("begin");
    await client.query(`create schema if not exists ${LIVE}`);
    for (const t of tables) {
      await client.query(`drop table if exists ${LIVE}.${t.name} cascade`);
      await client.query(`alter table ${STAGING}.${t.name} set schema ${LIVE}`);
    }
    await client.query(IMPORT_INFO_DDL);
    await client.query(
      `insert into ${LIVE}.discogs_import_info (entity, dump_file, rows, imported_at) values ($1, $2, $3, now())
       on conflict (entity) do update set dump_file = excluded.dump_file, rows = excluded.rows, imported_at = now()`,
      [entity, path.basename(file), records],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return records;
}

// ---------- main ----------
async function main() {
  const wanted = only ?? ENTITIES;
  const plan = wanted.map((e) => ({ entity: e, file: findDump(e) })).filter((p) => p.file || only);
  for (const p of plan) if (!p.file) throw new Error(`no discogs_YYYYMMDD_${p.entity}.xml(.gz) in ${dir}`);
  if (plan.length === 0) throw new Error(`no Discogs dumps found in ${dir}`);

  const target = new URL(connectionString);
  console.log(`discogs import → ${target.host}${target.pathname} (tables discogs_* in schema "${LIVE}")${limit ? `, first ${limit} records each` : ""}`);
  const pool = new pg.Pool({ connectionString, max: 6 });
  try {
    await pool.query("create extension if not exists pg_trgm");
    for (const { entity, file } of plan) {
      console.log(`→ ${entity} from ${path.basename(file!)} (${(statSync(file!).size / 1e9).toFixed(1)} GB)`);
      const n = await importEntity(pool, entity, file!);
      console.log(`✓ ${entity}: ${n.toLocaleString()} records live`);
    }
    await pool.query(`drop schema if exists ${STAGING} cascade`);
  } catch (err) {
    // Don't leave half-loaded staging tables behind; the live tables are untouched.
    await pool.query(`drop schema if exists ${STAGING} cascade`).catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

if (!existsSync(dir)) {
  console.error(`directory not found: ${dir}`);
  process.exit(1);
}
main().catch((err) => {
  console.error("discogs import failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
