import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

/** The signed-in user, set on the request by `requireAuth`. */
export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

/**
 * preHandler: resolve the Better Auth session (web: session cookie; mobile:
 * the cookie the Expo client sends as a header) and expose the user as
 * `req.authUser`. 401 without a valid session.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
  if (!session) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const u = session.user as typeof session.user & { username?: string | null; displayUsername?: string | null };
  req.authUser = {
    id: u.id,
    username: u.displayUsername ?? u.username ?? u.name,
    name: u.name,
    email: u.email,
  };
}
