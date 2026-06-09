/** Runs all pending migrations. Invoked via `pnpm --filter @sonic/server migrate`. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely";
import { db } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`${r.status === "Success" ? "✓" : "✗"} ${r.migrationName}`);
  }
  if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
  await db.destroy();
}

main();
