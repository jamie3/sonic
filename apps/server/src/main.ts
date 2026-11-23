/** Sonic API (+ the built web app). Background work runs in apps/matcher and apps/extractor. */
import { serve } from "./server.js";

serve().catch((err) => {
  console.error(err);
  process.exit(1);
});
