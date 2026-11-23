/**
 * Bridges Fastify → Better Auth for everything under /api/auth/* (sign-in,
 * sign-up, sign-out, session, change-password, …). Registered inside the /api
 * scope, so the API-wide rate limit applies too.
 *
 * Also keeps the failed-login lockout (security/login-throttle.ts) in front of
 * username sign-in: 5 wrong passwords for a username from one IP lock it out
 * for 15 minutes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { LoginThrottle } from "../security/login-throttle.js";

const SIGN_IN = "/api/auth/sign-in/username";

/** Lockout body: `message` for the Better Auth client, `error` like the rest of the API. */
const lockedOut = (seconds: number) => {
  const text = `Too many failed logins — try again in ${Math.ceil(seconds / 60)} minutes.`;
  return { error: text, message: text };
};

export async function betterAuthRoutes(app: FastifyInstance) {
  const throttle = new LoginThrottle();

  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    schema: { hide: true }, // Better Auth's own endpoints; not in our OpenAPI docs
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const path = req.url.split("?")[0];
      const signIn = req.method === "POST" && path === SIGN_IN;
      const username = signIn ? String((req.body as { username?: unknown } | undefined)?.username ?? "") : "";

      if (signIn) {
        const wait = throttle.retryAfter(req.ip, username);
        if (wait > 0) {
          req.log.warn({ ip: req.ip, username }, "sign-in refused: locked out after failed attempts");
          return reply.code(429).header("retry-after", String(wait)).send(lockedOut(wait));
        }
      }

      const headers = fromNodeHeaders(req.headers);
      // Better Auth reads the client IP from X-Forwarded-For. Set it from
      // Fastify's req.ip (which honours TRUST_PROXY) so clients can't spoof it.
      headers.set("x-forwarded-for", req.ip);
      const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? "localhost"}`);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers,
          body: req.body !== undefined && req.method !== "GET" ? JSON.stringify(req.body) : undefined,
        }),
      );

      if (signIn) {
        if (response.ok) throttle.succeed(req.ip, username);
        else if (response.status === 401) {
          const locked = throttle.fail(req.ip, username);
          req.log.warn({ ip: req.ip, username, lockedForSeconds: locked || undefined }, "sign-in failed");
          if (locked > 0) {
            return reply.code(429).header("retry-after", String(locked)).send(lockedOut(locked));
          }
        }
      }

      reply.status(response.status);
      // Several Set-Cookie headers (session token + cached session data) must
      // stay separate; forEach would join them into one.
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie" && key !== "content-length") reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
