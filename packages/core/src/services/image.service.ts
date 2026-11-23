import type { Readable } from "node:stream";
import { NotFoundError } from "../errors.js";
import type { Repositories } from "../repositories/index.js";
import type { Owner } from "../repositories/owner.js";
import type { ImageStorage } from "../storage/index.js";

/** Read access to stored capture photos — only the capture owner's. */
export class ImageService {
  constructor(
    private readonly storage: ImageStorage,
    private readonly repos: Repositories,
  ) {}

  async open(owner: Owner, key: string): Promise<Readable> {
    // Keys are relative paths like "captures/<captureId>/front-ab12cd34.jpg".
    // Refuse anything that could escape the storage root, then check the
    // capture belongs to the requester (trashed captures included, so the
    // Trash page can show them). Someone else's photo is a 404, not a 403.
    const parts = key.split(/[\\/]/);
    if (!key || key.startsWith("/") || parts.includes("..") || parts[0] !== "captures" || !parts[1]) {
      throw new NotFoundError();
    }
    if (!(await this.repos.captures.findByIdIncludingTrashed(parts[1], owner))) throw new NotFoundError();
    try {
      return await this.storage.getStream(key);
    } catch {
      throw new NotFoundError();
    }
  }
}
