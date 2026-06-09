/**
 * Image storage seam. LocalDiskStorage now; S3Storage later — callers only see
 * this interface (architecture.md §4.4).
 */
import { createReadStream, promises as fs } from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { config } from "../config.js";

export interface StoredObject {
  key: string;
  size: number;
}

export interface ImageStorage {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  url(key: string): string;
  delete(key: string): Promise<void>;
}

class LocalDiskStorage implements ImageStorage {
  constructor(private root: string) {}

  private full(key: string) {
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const dest = this.full(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    return { key, size: data.length };
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.full(key));
  }

  /** Served behind the API's protected /images route. */
  url(key: string): string {
    return `/images/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }
}

function createStorage(): ImageStorage {
  switch (config.STORAGE_DRIVER) {
    case "disk":
      return new LocalDiskStorage(config.IMAGE_DIR);
    case "s3":
      throw new Error("S3Storage not implemented yet — see architecture.md §10");
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${config.STORAGE_DRIVER}`);
  }
}

export const storage: ImageStorage = createStorage();
