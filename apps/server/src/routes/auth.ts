import type { FastifyPluginAsync } from "fastify";
import { LoginRequest } from "@sonic/shared";
import { requireAuth, verifyCredentials } from "../auth.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (req, reply) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });

    const { username, password } = parsed.data;
    if (!(await verifyCredentials(username, password))) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = app.jwt.sign({ sub: username });
    return { token, username };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (req) => {
    return { username: req.user.sub };
  });
};
