/**
 * Accounts in the database instead of environment variables, so the password
 * can be changed from the app. One row today (the owner). On API start, if the
 * table is empty, the owner is created from AUTH_USERNAME / AUTH_PASSWORD_HASH.
 *
 * `token_version` is embedded in each JWT; bumping it (on password change)
 * signs out every other session.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("app_user")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("username", "text", (c) => c.notNull())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("token_version", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("password_changed_at", "timestamptz")
    .execute();
  // Usernames are unique case-insensitively ("Jamie" and "jamie" are the same account).
  await sql`create unique index app_user_username_key on app_user (lower(username))`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("app_user").execute();
}
