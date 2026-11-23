/** Shared migration runner used by the migrate / reset scripts. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator, NO_MIGRATIONS } from "kysely";
import { db } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildMigrator() {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  });
}

function report(results: Awaited<ReturnType<Migrator["migrateToLatest"]>>["results"]) {
  for (const r of results ?? []) {
    console.log(`${r.status === "Success" ? "✓" : "✗"} ${r.direction} ${r.migrationName}`);
  }
}

/** Apply all pending migrations. */
export async function migrateToLatest(): Promise<void> {
  const { error, results } = await buildMigrator().migrateToLatest();
  report(results);
  if (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

/** Roll every migration all the way back down (drops all tables). */
export async function migrateDownAll(): Promise<void> {
  const { error, results } = await buildMigrator().migrateTo(NO_MIGRATIONS);
  report(results);
  if (error) {
    console.error("Rollback failed:", error);
    throw error;
  }
}
