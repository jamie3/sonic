/** Runs all pending migrations. Invoked via `pnpm db:migrate`. */
import { db } from "./index.js";
import { migrateToLatest } from "./migrator.js";

async function main() {
  try {
    await migrateToLatest();
  } catch {
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
