import type { TrashItem, TrashKind, TrashList } from "@sonic/shared";
import { ConflictError, NotFoundError } from "../errors.js";
import type { PhotoUrlFn } from "../mappers/capture.mapper.js";
import type { Repositories, TransactionRunner } from "../repositories/index.js";
import type { Owner } from "../repositories/owner.js";
import type { ImageStorage } from "../storage/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trash bin. Deleting moves an item to the trash (soft delete); restoring
 * brings it back; the purge — the daily job, "Delete forever", or "Empty
 * trash" — removes it permanently along with its photo files.
 *
 * Two kinds of item: catalog entries, and unidentified captures (uploads that
 * never became entries). An approved capture belongs to its entry and goes
 * with it.
 */
export class TrashService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly storage: ImageStorage,
    private readonly photoUrl: PhotoUrlFn,
    readonly retentionDays: number,
  ) {}

  async trashEntry(owner: Owner, id: string): Promise<void> {
    if (!(await this.repos.catalog.setDeleted(id, new Date(), owner))) throw new NotFoundError();
  }

  async trashCapture(owner: Owner, id: string): Promise<void> {
    const cap = await this.repos.captures.findById(id, owner);
    if (!cap) throw new NotFoundError();
    if (cap.status === "approved") {
      throw new ConflictError("this capture is in the catalog — delete the catalog entry instead");
    }
    await this.repos.captures.setDeleted(id, new Date(), owner);
  }

  async restore(owner: Owner, kind: TrashKind, id: string): Promise<void> {
    const repo = kind === "entry" ? this.repos.catalog : this.repos.captures;
    if (!(await repo.setDeleted(id, null, owner))) throw new NotFoundError("not in the trash");
  }

  async list(owner: Owner): Promise<TrashList> {
    const [entries, captures] = await Promise.all([
      this.repos.catalog.listTrashed(owner),
      this.repos.captures.listTrashed(owner),
    ]);

    const items: TrashItem[] = [];
    for (const e of entries) {
      const photos = e.capture_id ? await this.repos.captures.findPhotos(e.capture_id) : [];
      const photo = photos.find((p) => p.type === "front") ?? photos[0];
      items.push(
        this.item("entry", e.entry_id, e.title, e.artist, e.cover_url ?? (photo ? this.photoUrl(photo.storage_key) : null), e.deleted_at),
      );
    }
    for (const c of captures) {
      const [photos, candidates] = await Promise.all([
        this.repos.captures.findPhotos(c.id),
        this.repos.captures.findCandidates(c.id),
      ]);
      const photo = photos.find((p) => p.type === "front") ?? photos[0];
      const top = candidates[0];
      items.push(
        this.item(
          "capture",
          c.id,
          top ? top.title : "Unidentified record",
          top ? `${top.artist} · not approved` : `Uploaded ${new Date(c.created_at).toISOString().slice(0, 10)}`,
          photo ? this.photoUrl(photo.storage_key) : null,
          c.deleted_at!,
        ),
      );
    }
    items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return { items, retentionDays: this.retentionDays };
  }

  /** "Delete forever": permanently remove one trashed item now. */
  async purge(owner: Owner, kind: TrashKind, id: string): Promise<void> {
    const removed = kind === "entry" ? await this.purgeEntry(id, owner) : await this.purgeCapture(id, owner);
    if (!removed) throw new NotFoundError("not in the trash");
  }

  /** Daily job: permanently remove items trashed longer than the retention period — every user's. */
  async purgeExpired(now = new Date()): Promise<{ entries: number; captures: number }> {
    return this.purgeOlderThan(new Date(now.getTime() - this.retentionDays * DAY_MS), null);
  }

  /** "Empty trash": permanently remove everything in the owner's trash now. */
  async emptyTrash(owner: Owner): Promise<{ entries: number; captures: number }> {
    return this.purgeOlderThan(new Date(Date.now() + DAY_MS), owner);
  }

  private async purgeOlderThan(cutoff: Date, owner: Owner) {
    let entries = 0;
    let captures = 0;
    for (const e of await this.repos.catalog.listTrashedBefore(cutoff, owner)) {
      if (await this.purgeEntry(e.id, owner)) entries++;
    }
    for (const id of await this.repos.captures.listTrashedBefore(cutoff, owner)) {
      if (await this.purgeCapture(id, owner)) captures++;
    }
    return { entries, captures };
  }

  /** Delete a trashed entry, its approved capture, and their photo files. */
  private async purgeEntry(id: string, owner: Owner): Promise<boolean> {
    const keys: string[] = [];
    const removed = await this.tx.run(async (repos) => {
      const { exists, captureId } = await repos.catalog.findCaptureIdIncludingTrashed(id, owner);
      if (!exists) return false;
      if (captureId) keys.push(...(await repos.captures.findPhotos(captureId)).map((p) => p.storage_key));
      if (!(await repos.catalog.hardDeleteTrashed(id, owner))) return false; // not in the trash
      if (captureId) await repos.captures.hardDeleteApproved(captureId);
      await repos.tags.deleteUnused();
      return true;
    });
    if (removed) await this.deleteFiles(keys);
    return removed;
  }

  /** Delete a trashed unidentified capture and its photo files. */
  private async purgeCapture(id: string, owner: Owner): Promise<boolean> {
    const keys: string[] = [];
    const removed = await this.tx.run(async (repos) => {
      if (!(await repos.captures.findByIdIncludingTrashed(id, owner))) return false;
      keys.push(...(await repos.captures.findPhotos(id)).map((p) => p.storage_key));
      return repos.captures.hardDeleteTrashed(id, owner);
    });
    if (removed) await this.deleteFiles(keys);
    return removed;
  }

  /** Files go after the rows are committed; a failure leaves an orphan file, never a dangling row. */
  private async deleteFiles(keys: string[]) {
    const results = await Promise.allSettled(keys.map((k) => this.storage.delete(k)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) console.warn(`trash: ${failed} photo file(s) couldn't be deleted`);
  }

  private item(kind: TrashKind, id: string, title: string, subtitle: string, imageUrl: string | null, deletedAt: Date): TrashItem {
    const deleted = new Date(deletedAt);
    return {
      kind,
      id,
      title,
      subtitle,
      imageUrl,
      deletedAt: deleted.toISOString(),
      purgeAt: new Date(deleted.getTime() + this.retentionDays * DAY_MS).toISOString(),
    };
  }
}
