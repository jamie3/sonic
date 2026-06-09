/** Single-user auth: username/password (bcrypt) → JWT. */
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  if (username !== config.AUTH_USERNAME) return false;
  return bcrypt.compare(password, config.AUTH_PASSWORD_HASH);
}

/** preHandler that rejects requests without a valid JWT. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "unauthorized" });
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export type AuthedServer = FastifyInstance;
