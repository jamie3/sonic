/**
 * Full reset for local dev: rolls every migration back down, re-applies them,
 * then seeds fake data. Invoked via `pnpm db:reset`.
 */
import { db } from "./index.js";
import { migrateDownAll, migrateToLatest } from "./migrator.js";
import { seed } from "./seed.js";

async function main() {
  try {
    console.log("↓ rolling back all migrations…");
    await migrateDownAll();
    console.log("↑ re-applying migrations…");
    await migrateToLatest();
    console.log("🌱 seeding…");
    await seed();
  } catch (err) {
    console.error("Reset failed:", err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
