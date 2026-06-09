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

const apiUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:3001";

export const api = new SonicClient({
  baseUrl: apiUrl,
  getToken: () => cachedToken,
});
