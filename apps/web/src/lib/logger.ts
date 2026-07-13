import pino from "pino";

/**
 * Browser-side application logger. Pino ships a browser build that writes to
 * the console; in dev we log everything, in prod we keep it to warnings+.
 */
export const logger = pino({
  level: import.meta.env.DEV ? "debug" : "warn",
  browser: {
    asObject: true,
  },
});
