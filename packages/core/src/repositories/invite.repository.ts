import { randomInt } from "node:crypto";
import { type Kysely, sql } from "kysely";
import type { Database } from "../db/types.js";

/** Invite codes look like SONIC-7KQ2-M9XD: no 0/O/1/I/L to misread. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** A sign-up holds its code this long; a crash mid-sign-up frees it afterwards. */
const CLAIM_TIMEOUT = sql`interval '10 minutes'`;

export function newInviteCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `SONIC-${part()}-${part()}`;
}

/** Normalize what a person typed: case, spaces, missing dashes. */
export function normalizeInviteCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 13 && c.startsWith("SONIC") ? `SONIC-${c.slice(5, 9)}-${c.slice(9)}` : code.trim().toUpperCase();
}

/** Invite codes for invite-only sign-up (`invites`). */
export class InviteRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(createdBy: string | null, expiresAt: Date | null): Promise<string> {
    const code = newInviteCode();
    await this.db.insertInto("invites").values({ code, created_by: createdBy, expires_at: expiresAt }).execute();
    return code;
  }

  /** Invites a user created, newest first. */
  listByCreator(userId: string) {
    return this.db
      .selectFrom("invites as i")
      .leftJoin("users as u", "u.id", "i.used_by")
      .select(["i.code", "i.created_at", "i.expires_at", "i.used_at", "u.username as used_by_username"])
      .where("i.created_by", "=", userId)
      .orderBy("i.created_at", "desc")
      .execute();
  }

  async countUnused(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom("invites")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("created_by", "=", userId)
      .where("used_at", "is", null)
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** Delete an unused invite the user created. */
  async revoke(code: string, userId: string): Promise<boolean> {
    const r = await this.db
      .deleteFrom("invites")
      .where("code", "=", normalizeInviteCode(code))
      .where("created_by", "=", userId)
      .where("used_at", "is", null)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  /**
   * Reserve an invite for a sign-up in progress. Atomic: two sign-ups with the
   * same code can't both get it. False if unknown, used, expired or held.
   */
  async claim(code: string): Promise<boolean> {
    const row = await this.db
      .updateTable("invites")
      .set({ claimed_at: new Date() })
      .where("code", "=", normalizeInviteCode(code))
      .where("used_at", "is", null)
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]))
      .where((eb) => eb.or([eb("claimed_at", "is", null), eb("claimed_at", "<", sql<Date>`now() - ${CLAIM_TIMEOUT}`)]))
      .returning("code")
      .executeTakeFirst();
    return !!row;
  }

  /** Sign-up failed after claiming: free the code again. */
  async release(code: string): Promise<void> {
    await this.db
      .updateTable("invites")
      .set({ claimed_at: null })
      .where("code", "=", normalizeInviteCode(code))
      .where("used_at", "is", null)
      .execute();
  }

  async markUsed(code: string, userId: string): Promise<void> {
    await this.db
      .updateTable("invites")
      .set({ used_at: new Date(), used_by: userId })
      .where("code", "=", normalizeInviteCode(code))
      .execute();
  }

  async countUsers(): Promise<number> {
    const row = await this.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }
}
