/**
 * Create an invite code from the terminal (sign-up is invite-only).
 *
 *   pnpm invite:create                 # from the first account, valid 14 days
 *   pnpm invite:create --from alice    # attribute it to another account
 *   pnpm invite:create --days 30
 *
 * On a fresh install with no accounts, nobody needs an invite: the first
 * sign-up is open.
 */
import { db } from "../db/index.js";
import { InviteRepository } from "../repositories/invite.repository.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const days = Number(flag("days") ?? 14);
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");
  const from = flag("from")?.toLowerCase();
  const user = await db
    .selectFrom("users")
    .select(["id", "username"])
    .$if(!!from, (q) => q.where("username", "=", from!))
    .orderBy("created_at")
    .executeTakeFirst();
  if (!user) {
    console.log(from ? `No account named "${from}".` : "No accounts yet — the first sign-up doesn't need an invite.");
    return;
  }
  const code = await new InviteRepository(db).create(user.id, new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  console.log(`${code}   (from ${user.username}, valid ${days} days, single use)`);
}

main()
  .catch((err) => {
    console.error("invite:create failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
