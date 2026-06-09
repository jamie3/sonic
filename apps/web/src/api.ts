import { SonicClient } from "@sonic/api-client";

const TOKEN_KEY = "sonic.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export const api = new SonicClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:3001",
  getToken,
});
