/**
 * Permanently delete expired trash once and exit — for an external cron, if
 * you'd rather not rely on the matcher's daily schedule. `pnpm trash:purge`.
 */
import { db } from "@sonic/core/db";
import { createServices } from "@sonic/core/services";
import { storage } from "@sonic/core/storage";

async function main() {
  const services = createServices({
    db,
    storage,
    queue: { enqueueExtract: async () => {}, enqueueRecognize: async () => {} }, // not used by the purge
    metadata: null,
  });
  const r = await services.trash.purgeExpired();
  console.log(`purge-trash: removed ${r.entries} entries, ${r.captures} captures`);
}

main()
  .catch((err) => {
    console.error("purge-trash failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
