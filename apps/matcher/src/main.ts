/** Sonic matcher — see matcher.ts. */
import { startMatcher } from "./matcher.js";

startMatcher().catch((err) => {
  console.error("matcher failed to start:", err);
  process.exit(1);
});
