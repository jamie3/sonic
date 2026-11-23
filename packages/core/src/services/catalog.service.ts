import type { Updateable } from "kysely";
import type {
  CatalogEntry,
  CatalogFacets,
  CatalogSearchQuery,
  CatalogSearchResult,
  TagSummary,
  UpdateCatalogEntry,
} from "@sonic/shared";
import type { CatalogEntryTable, ReleaseTable } from "../db/types.js";
import { NotFoundError } from "../errors.js";
import { toCatalogEntryDto } from "../mappers/catalog.mapper.js";
import type { PhotoUrlFn } from "../mappers/capture.mapper.js";
import type { Repositories, TransactionRunner } from "../repositories/index.js";
import type { Owner } from "../repositories/owner.js";
import { normalizeTags } from "./tags.js";

/** Browsing and editing a user's catalog. Every method is scoped to `owner`. */
export class CatalogService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly photoUrl: PhotoUrlFn,
  ) {}

  async search(owner: Owner, q: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const { ids, total } = await this.repos.catalog.search(q, owner);
    const items = await Promise.all(ids.map((id) => this.get(owner, id)));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(owner: Owner, id: string): Promise<CatalogEntry> {
    const row = await this.repos.catalog.findById(id, owner);
    if (!row) throw new NotFoundError();
    const [photos, tags] = await Promise.all([
      row.capture_id ? this.repos.captures.findPhotos(row.capture_id) : [],
      this.repos.tags.namesForEntries([id]),
    ]);
    return toCatalogEntryDto(row, photos, tags.get(id) ?? [], this.photoUrl);
  }

  /** What the owner's catalog can be filtered by: labels, countries, years (with counts). */
  facets(owner: Owner): Promise<CatalogFacets> {
    return this.repos.catalog.facets(owner);
  }

  listTags(owner: Owner): Promise<TagSummary[]> {
    return this.repos.tags.listWithCounts(owner);
  }

  /**
   * Update editable columns of an entry, its tags, and/or its release. Only
   * fields present in `d` are written; empty strings clear nullable text
   * columns; `tags` replaces the whole set.
   */
  async update(owner: Owner, id: string, d: UpdateCatalogEntry): Promise<CatalogEntry> {
    await this.tx.run(async (repos) => {
      let releaseId = await repos.catalog.findReleaseId(id, owner);
      if (!releaseId) throw new NotFoundError();

      const ce: Updateable<CatalogEntryTable> = {};
      if (d.condition !== undefined) ce.condition = d.condition;
      if (d.location !== undefined) ce.location = d.location || null;
      if (d.purchasePrice !== undefined) ce.purchase_price = d.purchasePrice;
      if (d.purchaseDate !== undefined) ce.purchase_date = d.purchaseDate || null;
      if (d.notes !== undefined) ce.notes = d.notes || null;
      await repos.catalog.update(id, ce, owner);

      if (d.tags !== undefined) {
        await repos.tags.setForEntry(id, normalizeTags(d.tags));
        await repos.tags.deleteUnused();
      }

      if (d.release) {
        // Releases are a cache shared by every user who owns that pressing:
        // edit this entry's own copy, never the shared row.
        const own = await repos.releases.ensureOwnCopy(releaseId, id);
        if (own !== releaseId) {
          await repos.catalog.update(id, { release_id: own }, owner);
          releaseId = own;
        }
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
        if (rd.coverUrl !== undefined) r.cover_url = rd.coverUrl || null;
        await repos.releases.update(releaseId, r);
      }
    });
    return this.get(owner, id);
  }
}
