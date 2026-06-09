/** Single entrypoint; `serve` runs the API, `work` runs the recognition worker. */
import { serve } from "./server.js";
import { work } from "./worker.js";

const mode = process.argv[2] ?? "serve";

async function main() {
  if (mode === "serve") await serve();
  else if (mode === "work") await work();
  else {
    console.error(`Unknown mode "${mode}". Use "serve" or "work".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
