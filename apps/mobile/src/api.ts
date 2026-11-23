import { expoClient } from "@better-auth/expo/client";
import { SonicClient } from "@sonic/api-client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/** Minimum password length — mirrors the server (apps/server/src/auth.ts). */
export const PASSWORD_MIN = 10;

/**
 * Resolve the API base URL. On a physical device "localhost" points at the
 * phone, not the dev machine — so when the configured URL is localhost, swap in
 * the LAN IP that Expo is already serving the bundle from (Constants.hostUri,
 * e.g. "192.168.1.20:8081").
 */
function resolveApiUrl(): string {
  const configured =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:3005/api";

  if (/\/\/(localhost|127\.0\.0\.1)/.test(configured)) {
    const hostUri =
      Constants.expoConfig?.hostUri ??
      (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
      "";
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      // Swap only the hostname — keep port and the /api path.
      return configured.replace(/\/\/(localhost|127\.0\.0\.1)/, `//${host}`);
    }
  }
  return configured;
}

export const apiUrl = resolveApiUrl();
/** Scheme + host + port of the API, for resolving server-relative URLs. */
export const apiOrigin = apiUrl.replace(/\/api\/?$/, "");

/**
 * Accounts and sessions (Better Auth, mounted at <apiOrigin>/api/auth — the
 * client's default basePath). The Expo plugin keeps the session cookie in
 * SecureStore and sends it as a `Cookie` header on auth requests.
 */
export const authClient = createAuthClient({
  baseURL: apiOrigin,
  plugins: [
    expoClient({ scheme: "sonic", storagePrefix: "sonic", storage: SecureStore }),
    usernameClient(),
  ],
});

/**
 * In-memory copy of the session cookie. `authClient.getCookie()` is async
 * (SecureStore), but React Native image sources are built synchronously, so
 * the app refreshes this whenever the session changes (see App.tsx).
 */
let sessionCookie = "";

/** Re-read the stored session cookie into memory; returns it ("" if none). */
export async function refreshSessionCookie(): Promise<string> {
  sessionCookie = await authClient.getCookie().catch(() => "");
  return sessionCookie;
}

/** Forget the in-memory cookie (sign-out). */
export function clearSessionCookie() {
  sessionCookie = "";
}

/** Whether we hold a session cookie (not whether the server still accepts it). */
export function hasSessionCookie(): boolean {
  return sessionCookie !== "";
}

/**
 * Image source for a URL from the API. Server photos are relative
 * ("/api/images/…") and need the session cookie; cover art is absolute.
 */
export function imageSource(url: string): { uri: string; headers?: Record<string, string> } {
  if (!url.startsWith("/")) return { uri: url };
  return {
    uri: `${apiOrigin}${url}`,
    headers: sessionCookie ? { Cookie: sessionCookie } : undefined,
  };
}

/**
 * Our own API, authenticated by the Better Auth session cookie sent by hand
 * (`credentials: "omit"` so the native cookie jar never interferes).
 */
export const api = new SonicClient({
  baseUrl: apiUrl,
  credentials: "omit",
  getHeaders: async (): Promise<Record<string, string>> => {
    const cookie = await refreshSessionCookie();
    return cookie ? { Cookie: cookie } : {};
  },
});

/**
 * Our API answered 401: the session is gone (expired, revoked, signed out
 * elsewhere). Re-check it with the server; if it really is over, useSession()
 * turns null and the app goes back to the sign-in screen. Throttled so a burst
 * of failing requests triggers one check.
 */
let lastUnauthorizedAt = 0;
export function onUnauthorized() {
  const now = Date.now();
  if (now - lastUnauthorizedAt < 5_000) return;
  lastUnauthorizedAt = now;
  authClient.$store.notify("$sessionSignal");
}

/** Readable message from a Better Auth client error ({ status, message }). */
export function authErrorMessage(
  error: { status?: number; message?: string } | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (error.status === 429) return error.message || "Too many attempts — try again later";
  if (error.status === 0 || error.status === undefined) return "Couldn't reach the server";
  return error.message || fallback;
}
