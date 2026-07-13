import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { config } from "../config.js";
import type { Database } from "./types.js";

// Return DATE columns (oid 1082) as the raw "YYYY-MM-DD" string rather than a
// Date, so reformatting can't shift the day across timezones. Only purchase_date
// uses DATE; timestamptz columns are unaffected.
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
