/**
 * Accounts and sessions: Better Auth (https://www.better-auth.com).
 *
 * - Username + password sign-in (username plugin); sign-up needs an invite
 *   code (see invites below), except for the very first account.
 * - Web: same-origin session cookie. Mobile: the Expo plugin keeps the cookie
 *   in SecureStore and sends it as a `Cookie` header.
 * - Tables are snake_case (`users`, `sessions`, `accounts`, `verifications`),
 *   created by migration 008_better_auth.
 * - Passwords are bcrypt, so accounts migrated from the old single-user setup
 *   keep their password.
 */
import { createHash } from "node:crypto";
import { expo } from "@better-auth/expo";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import pg from "pg";
import { config } from "@sonic/core/config";
import { InviteRepository } from "@sonic/core/repositories/invite.repository";
import { db } from "@sonic/core/db";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

const baseURL = config.BETTER_AUTH_URL ?? `http://localhost:${config.PORT}`;
// Better Auth wants ≥32 chars; derive a stable one from JWT_SECRET if not set.
const secret = config.BETTER_AUTH_SECRET ?? createHash("sha256").update(`sonic-auth:${config.JWT_SECRET}`).digest("hex");

const invites = new InviteRepository(db);

/** Origins allowed to make authenticated requests (web app, Vite dev server, mobile app). */
export const TRUSTED_ORIGINS = [
  new URL(baseURL).origin,
  "http://localhost:5173", // Vite dev server (proxies /api)
  "sonic://", // mobile app scheme
  ...(config.NODE_ENV === "development" ? ["exp://", "exp://**"] : []),
];

export const auth = betterAuth({
  appName: "Sonic",
  baseURL,
  basePath: "/api/auth",
  secret,
  // Better Auth ships its own Kysely; give it a plain pool (same database).
  database: new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 }),
  trustedOrigins: TRUSTED_ORIGINS,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    password: {
      hash: (password) => bcrypt.hash(password, 12),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
  },

  session: {
    modelName: "sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    // No cookie cache: every request checks the session row (an indexed
    // lookup), so signing out / changing the password ends other sessions
    // immediately rather than after the cache expires.
    cookieCache: { enabled: false },
  },
  user: {
    modelName: "users",
    fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
  },
  account: {
    modelName: "accounts",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "verifications",
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },

  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      schema: { user: { fields: { displayUsername: "display_username" } } },
    }),
    expo(),
  ],

  // Throttles the auth endpoints (on top of the API-wide @fastify/rate-limit).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/username": { window: 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/change-password": { window: 60, max: 5 },
    },
  },

  hooks: {
    // Invite-only sign-up: claim the code before the account is created…
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const code = String((ctx.body as { inviteCode?: unknown })?.inviteCode ?? "").trim();
      // The very first account needs no invite (fresh install).
      if (!code && (await invites.countUsers()) === 0) return;
      if (!code) throw new APIError("BAD_REQUEST", { message: "An invite code is required to sign up." });
      if (!(await invites.claim(code))) {
        throw new APIError("BAD_REQUEST", { message: "That invite code is invalid, expired or already used." });
      }
    }),
    // …then record who used it, or release it if sign-up failed.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const code = String((ctx.body as { inviteCode?: unknown })?.inviteCode ?? "").trim();
      if (!code) return;
      const userId = ctx.context.newSession?.user.id;
      if (userId) await invites.markUsed(code, userId);
      else await invites.release(code);
    }),
  },

  advanced: {
    // Behind a reverse proxy the client IP comes from X-Forwarded-For; the
    // Fastify bridge (routes/better-auth.ts) sets it from Fastify's req.ip.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },
});

export type Session = typeof auth.$Infer.Session;
