import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";
import { CaptureRepository } from "./capture.repository.js";
import { CatalogRepository } from "./catalog.repository.js";
import { ReleaseRepository } from "./release.repository.js";
import { TagRepository } from "./tag.repository.js";
import { InviteRepository } from "./invite.repository.js";

export { CaptureRepository, CatalogRepository, ReleaseRepository, TagRepository, InviteRepository };

/** All repositories bound to one executor (the pool, or a transaction). */
export function createRepositories(db: Kysely<Database>) {
  return {
    captures: new CaptureRepository(db),
    catalog: new CatalogRepository(db),
    releases: new ReleaseRepository(db),
    tags: new TagRepository(db),
    invites: new InviteRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/**
 * Runs a unit of work atomically. The callback receives repositories bound to
 * the transaction, so services compose repository calls without touching SQL.
 */
export interface TransactionRunner {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export class KyselyTransactionRunner implements TransactionRunner {
  constructor(private readonly db: Kysely<Database>) {}

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(createRepositories(trx)));
  }
}
