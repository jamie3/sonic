import { SonicClient } from "@sonic/api-client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin as the API: served by Fastify in production, proxied by Vite in
// dev. The browser sends the Better Auth session cookie with every request,
// so the API client needs no token.
export const api = new SonicClient({ baseUrl: "/api" });

/**
 * Accounts and sessions (Better Auth). Its endpoints live under /api/auth on
 * the same origin — the client's default — so no baseURL is needed.
 */
export const authClient = createAuthClient({ plugins: [usernameClient()] });

/** Readable message from a Better Auth client error ({ status, message }). */
export function authErrorMessage(error: { status?: number; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.status === 429) return error.message || "Too many attempts — try again later";
  if (error.status === 0 || error.status === undefined) return "Couldn’t reach the server";
  return error.message || fallback;
}
