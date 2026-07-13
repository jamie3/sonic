import { SonicClient } from "@sonic/api-client";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "sonic.token";

// SecureStore is async; we cache the token in memory for the client's sync getter.
let cachedToken: string | null = null;

export async function loadToken() {
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}
export async function saveToken(t: string | null) {
  cachedToken = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Resolve the API base URL. On a physical device "localhost" points at the
 * phone, not the dev machine — so when the configured URL is localhost, swap in
 * the LAN IP that Expo is already serving the bundle from (Constants.hostUri,
 * e.g. "192.168.1.20:8081").
 */
function resolveApiUrl(): string {
  const configured =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:3005";

  if (/\/\/(localhost|127\.0\.0\.1)/.test(configured)) {
    const hostUri =
      Constants.expoConfig?.hostUri ??
      (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
      "";
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      const port = configured.match(/:(\d+)/)?.[1] ?? "3005";
      return `http://${host}:${port}`;
    }
  }
  return configured;
}

export const apiUrl = resolveApiUrl();

export const api = new SonicClient({
  baseUrl: apiUrl,
  getToken: () => cachedToken,
});
