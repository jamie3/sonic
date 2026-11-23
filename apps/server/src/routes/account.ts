/**
 * The signed-in user's account: profile (+ library counts) and invite codes.
 * Sign-in, sign-up, sign-out and change-password are Better Auth's endpoints
 * under /api/auth/* (routes/better-auth.ts).
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { Invite, InviteList, Profile } from "@sonic/shared";
import { z } from "zod";
import { NotFoundError, TooManyRequestsError } from "@sonic/core/errors";
import { InviteRepository } from "@sonic/core/repositories/invite.repository";
import { db } from "@sonic/core/db";
import { requireAuth } from "../middleware/require-auth.js";
import { bearerAuth, errors } from "../schemas/common.js";

/** Unused, unexpired invites a user may hold at once. */
const MAX_UNUSED_INVITES = 5;
const INVITE_DAYS = 14;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  const invites = new InviteRepository(db);
  const s = app.services;
  app.addHook("preHandler", requireAuth);

  app.get(
    "/profile",
    {
      schema: {
        tags: ["account"],
        summary: "Profile",
        description: "The signed-in account and a summary of its library.",
        security: bearerAuth,
        response: { 200: Profile, ...errors(401) },
      },
    },
    async (req) => {
      const me = req.authUser;
      const [user, catalog, review, trash] = await Promise.all([
        db.selectFrom("users").select("created_at").where("id", "=", me.id).executeTakeFirst(),
        s.catalog.search(me.id, { page: 1, pageSize: 1 }),
        s.captures.list(me.id, { scope: "review" }),
        s.trash.list(me.id),
      ]);
      return {
        id: me.id,
        username: me.username,
        name: me.name,
        email: me.email,
        createdAt: iso(user?.created_at ?? new Date())!,
        stats: { catalog: catalog.total, awaitingReview: review.length, inTrash: trash.items.length },
      };
    },
  );

  const list = async (userId: string) => {
    const [rows, unused] = await Promise.all([invites.listByCreator(userId), invites.countUnused(userId)]);
    return {
      invites: rows.map((r) => ({
        code: r.code,
        createdAt: iso(r.created_at)!,
        expiresAt: iso(r.expires_at),
        usedAt: iso(r.used_at),
        usedBy: r.used_by_username ?? null,
      })),
      remaining: Math.max(0, MAX_UNUSED_INVITES - unused),
    };
  };

  app.get(
    "/invites",
    {
      schema: {
        tags: ["account"],
        summary: "My invite codes",
        security: bearerAuth,
        response: { 200: InviteList, ...errors(401) },
      },
    },
    async (req) => list(req.authUser.id),
  );

  app.post(
    "/invites",
    {
      schema: {
        tags: ["account"],
        summary: "Create an invite code",
        description: `A single-use code someone can sign up with, valid for ${INVITE_DAYS} days. At most ${MAX_UNUSED_INVITES} unused at a time.`,
        security: bearerAuth,
        response: { 201: Invite, ...errors(401, 429) },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const me = req.authUser.id;
      if ((await invites.countUnused(me)) >= MAX_UNUSED_INVITES) {
        throw new TooManyRequestsError(
          `you already have ${MAX_UNUSED_INVITES} unused invites — revoke one or wait until they're used`,
        );
      }
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
      const code = await invites.create(me, expiresAt);
      req.log.info({ userId: me }, "invite created");
      return reply.code(201).send({ code, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(), usedAt: null, usedBy: null });
    },
  );

  app.delete(
    "/invites/:code",
    {
      schema: {
        tags: ["account"],
        summary: "Revoke an unused invite code",
        security: bearerAuth,
        params: z.object({ code: z.string().min(1) }),
        response: { 204: z.null(), ...errors(401, 404) },
      },
    },
    async (req, reply) => {
      if (!(await invites.revoke(req.params.code, req.authUser.id))) throw new NotFoundError("no such unused invite");
      return reply.code(204).send(null);
    },
  );
};
