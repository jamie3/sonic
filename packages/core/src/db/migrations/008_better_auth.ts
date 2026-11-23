/**
 * Multi-user accounts via Better Auth, with per-user catalogs.
 *
 * 1. Better Auth's tables (snake_case: users, sessions, accounts,
 *    verifications) — columns match its schema for our options (username +
 *    expo plugins), see apps/server/src/auth.ts.
 * 2. invites: sign-up is invite-only.
 * 3. The existing owner (app_user, from migration 007) becomes the first
 *    Better Auth user; their bcrypt hash moves to accounts.password, so the
 *    password keeps working (auth.ts verifies bcrypt). Their email is a
 *    placeholder (<username>@users.sonic.invalid) until they set one.
 * 4. captures and catalog entries get an owner (user_id); existing rows go to
 *    that first user. Release/Discogs caches stay shared.
 * 5. app_user is dropped.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create table users (
      id text primary key,
      name text not null,
      email text not null unique,
      email_verified boolean not null default false,
      image text,
      username text unique,
      display_username text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);

  await sql`
    create table sessions (
      id text primary key,
      expires_at timestamptz not null,
      token text not null unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null,
      ip_address text,
      user_agent text,
      user_id text not null references users (id) on delete cascade
    )`.execute(db);
  await sql`create index sessions_user_id_idx on sessions (user_id)`.execute(db);

  await sql`
    create table accounts (
      id text primary key,
      account_id text not null,
      provider_id text not null,
      user_id text not null references users (id) on delete cascade,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null
    )`.execute(db);
  await sql`create index accounts_user_id_idx on accounts (user_id)`.execute(db);

  await sql`
    create table verifications (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index verifications_identifier_idx on verifications (identifier)`.execute(db);

  await sql`
    create table invites (
      code text primary key,
      created_by text references users (id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz,
      claimed_at timestamptz,
      used_at timestamptz,
      used_by text references users (id) on delete set null
    )`.execute(db);
  await sql`create index invites_created_by_idx on invites (created_by)`.execute(db);

  // 3. The single owner → first Better Auth user (password hash carried over).
  await sql`
    with owner as (
      insert into users (id, name, email, username, display_username, created_at, updated_at)
      select gen_random_uuid()::text, username, lower(username) || '@users.sonic.invalid',
             lower(username), username, created_at, now()
      from app_user
      order by created_at
      limit 1
      returning id
    )
    insert into accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
    select gen_random_uuid()::text, owner.id, 'credential', owner.id, a.password_hash, now(), now()
    from owner, (select password_hash from app_user order by created_at limit 1) a
  `.execute(db);

  // 4. Owners for existing data.
  for (const table of ["capture", "catalog_entry"]) {
    await sql`alter table ${sql.table(table)} add column user_id text references users (id) on delete cascade`.execute(db);
    await sql`update ${sql.table(table)} set user_id = (select id from users order by created_at limit 1)`.execute(db);
    const orphans = await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)} where user_id is null`.execute(db);
    if (Number(orphans.rows[0]?.n) > 0) {
      throw new Error(
        `${table} has rows but there is no account to own them. Set AUTH_USERNAME / AUTH_PASSWORD_HASH and start the API once (it creates the owner), then run the migration again.`,
      );
    }
    await sql`alter table ${sql.table(table)} alter column user_id set not null`.execute(db);
    await sql`create index ${sql.raw(`${table}_user_id_idx`)} on ${sql.table(table)} (user_id)`.execute(db);
  }

  await db.schema.dropTable("app_user").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    create table app_user (
      id uuid primary key default gen_random_uuid(),
      username text not null,
      password_hash text not null,
      token_version integer not null default 0,
      created_at timestamptz not null default now(),
      password_changed_at timestamptz
    )`.execute(db);
  await sql`create unique index app_user_username_key on app_user (lower(username))`.execute(db);
  await sql`
    insert into app_user (username, password_hash, created_at)
    select coalesce(u.display_username, u.username, u.name), a.password, u.created_at
    from users u join accounts a on a.user_id = u.id and a.provider_id = 'credential'
    order by u.created_at limit 1`.execute(db);
  for (const table of ["capture", "catalog_entry"]) {
    await sql`alter table ${sql.table(table)} drop column user_id`.execute(db);
  }
  for (const t of ["invites", "verifications", "accounts", "sessions", "users"]) {
    await db.schema.dropTable(t).execute();
  }
}
