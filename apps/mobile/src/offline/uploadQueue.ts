/**
 * Offline-first capture uploads.
 *
 * "Upload" never blocks on the network: photos are first copied into the app's
 * document directory (which the OS doesn't purge) with a manifest, then the
 * queue tries to send them. Anything that fails stays on the phone and is
 * retried when connectivity returns, when the app comes to the foreground,
 * every 30s while items are waiting, or on demand.
 *
 * Retries are safe: each capture's id is generated here and sent as
 * `captureId`, so a resend after a lost response returns the existing capture
 * instead of creating a duplicate.
 *
 * Layout on disk:
 *   <document>/sonic-uploads/<captureId>/manifest.json
 *   <document>/sonic-uploads/<captureId>/<photoType>.jpg
 *   <document>/sonic-uploads/uploaded.json   (recently uploaded capture ids)
 */
import { SonicApiError, SonicTimeoutError } from "@sonic/api-client";
import type { PhotoType } from "@sonic/shared";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api, hasSessionCookie, onUnauthorized } from "../api.js";
import type { MediaKind, TakenPhoto } from "../capture/shots.js";

export type QueuedStatus =
  | "waiting" // will be sent on the next attempt
  | "uploading"
  | "paused" // needs the user to log in again
  | "failed"; // the server rejected it (e.g. unreadable image); won't auto-retry

export interface QueuedCapture {
  /** Client-generated capture id, sent to the server for idempotency. */
  id: string;
  createdAt: string;
  media: MediaKind;
  barcode: string | null;
  photos: { type: PhotoType; file: string }[];
  attempts: number;
  status: QueuedStatus;
  lastError: string | null;
  lastAttemptAt?: string | null;
}

export interface QueueState {
  pending: QueuedCapture[]; // oldest first
  uploaded: string[]; // server capture ids, newest first
}

const MAX_UPLOADED = 30;
const RETRY_INTERVAL_MS = 30_000;
/** Generous for several ~1 MB photos on a weak connection, but never infinite. */
const UPLOAD_TIMEOUT_MS = 90_000;
/** A manual retry cancels an in-flight attempt that has run longer than this. */
const STUCK_AFTER_MS = 20_000;

const root = new Directory(Paths.document, "sonic-uploads");
const uploadedFile = new File(root, "uploaded.json");

let state: QueueState = { pending: [], uploaded: [] };
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;
/** Set when flush() is requested mid-run, so another pass follows. */
let rerun = false;
/** The upload currently on the wire, so a manual retry can cancel it if stuck. */
let inFlight: { id: string; controller: AbortController; startedAt: number } | null = null;
let started = false;

function setState(next: QueueState) {
  state = next;
  for (const l of listeners) l();
}

function updateItem(id: string, patch: Partial<QueuedCapture>) {
  setState({
    ...state,
    pending: state.pending.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  const item = state.pending.find((p) => p.id === id);
  if (item) writeManifest(item).catch(() => {}); // the folder may already be gone
}

const itemDir = (id: string) => new Directory(root, id);
export const photoUri = (item: QueuedCapture, file: string) => new File(itemDir(item.id), file).uri;

async function writeManifest(item: QueuedCapture) {
  // "uploading" is transient; persist it as "waiting" so a crash mid-upload retries.
  const persisted = { ...item, status: item.status === "uploading" ? "waiting" : item.status };
  await new File(itemDir(item.id), "manifest.json").write(JSON.stringify(persisted));
}

async function load() {
  root.create({ idempotent: true, intermediates: true });
  const pending: QueuedCapture[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    try {
      const manifest = new File(entry, "manifest.json");
      if (!manifest.exists) continue;
      pending.push(JSON.parse(await manifest.text()) as QueuedCapture);
    } catch {
      // Corrupt manifest: leave the folder for inspection rather than delete photos.
    }
  }
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let uploaded: string[] = [];
  try {
    if (uploadedFile.exists) uploaded = JSON.parse(await uploadedFile.text());
  } catch {
    uploaded = [];
  }
  setState({ pending, uploaded });
}

/** Save a capture to the phone and queue it for upload. Returns its capture id. */
export async function enqueueCapture(input: {
  media: MediaKind;
  barcode: string | null;
  photos: TakenPhoto[];
}): Promise<string> {
  const id = Crypto.randomUUID();
  const dir = itemDir(id);
  dir.create({ idempotent: true, intermediates: true });

  const photos: QueuedCapture["photos"] = [];
  for (const p of input.photos) {
    const name = `${p.type}.jpg`;
    const source = new File(p.uri);
    await source.copy(new File(dir, name));
    try {
      source.delete(); // the camera/manipulator temp file is no longer needed
    } catch {
      // best effort
    }
    photos.push({ type: p.type, file: name });
  }

  const item: QueuedCapture = {
    id,
    createdAt: new Date().toISOString(),
    media: input.media,
    barcode: input.barcode,
    photos,
    attempts: 0,
    status: "waiting",
    lastError: null,
  };
  await writeManifest(item);
  setState({ ...state, pending: [...state.pending, item] });
  void flush();
  return id;
}

/** Delete a queued capture and its photos from the phone. */
export function discardCapture(id: string) {
  if (inFlight?.id === id) inFlight.controller.abort();
  try {
    itemDir(id).delete();
  } catch {
    // already gone
  }
  setState({ ...state, pending: state.pending.filter((p) => p.id !== id) });
}

/**
 * Retry a failed/paused/waiting item (or everything) right now. Always does
 * something: re-arms the items, cancels an attempt that looks stuck, and makes
 * sure a pass runs even if one is already in progress.
 */
export function retryNow(id?: string): Promise<void> {
  setState({
    ...state,
    pending: state.pending.map((p) =>
      (!id || p.id === id) && p.status !== "uploading"
        ? { ...p, status: "waiting", lastError: null }
        : p,
    ),
  });
  if (inFlight && (!id || inFlight.id === id) && Date.now() - inFlight.startedAt > STUCK_AFTER_MS) {
    inFlight.controller.abort(); // the loop moves on and the rerun picks it up again
  }
  return flush();
}

/** Drop an uploaded capture from Recent captures (e.g. after moving it to the trash). */
export async function forgetUploaded(id: string) {
  const uploaded = state.uploaded.filter((u) => u !== id);
  setState({ ...state, uploaded });
  await uploadedFile.write(JSON.stringify(uploaded)).catch(() => {});
}

/** Look up a queued capture by id (for the detail view). */
export function getQueued(id: string): QueuedCapture | undefined {
  return state.pending.find((p) => p.id === id);
}

async function markUploaded(item: QueuedCapture) {
  try {
    itemDir(item.id).delete();
  } catch {
    // best effort; a leftover folder without a manifest is ignored on load
  }
  const uploaded = [item.id, ...state.uploaded.filter((u) => u !== item.id)].slice(0, MAX_UPLOADED);
  setState({ pending: state.pending.filter((p) => p.id !== item.id), uploaded });
  await uploadedFile.write(JSON.stringify(uploaded));
}

/**
 * Upload every waiting item, oldest first. Single-flight: a call while a pass
 * is running schedules one more pass instead of being dropped.
 */
export function flush(): Promise<void> {
  if (flushing) {
    rerun = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        rerun = false;
        await uploadPass();
      } while (rerun);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function uploadPass() {
  if (!hasSessionCookie()) {
    // Logged out: make that visible rather than silently doing nothing.
    setState({
      ...state,
      pending: state.pending.map((p) =>
        p.status === "waiting" ? { ...p, status: "paused", lastError: "Log in to resume uploading" } : p,
      ),
    });
    return;
  }
  for (const item of [...state.pending]) {
    const current = state.pending.find((p) => p.id === item.id);
    if (!current || current.status !== "waiting") continue;

    const controller = new AbortController();
    inFlight = { id: current.id, controller, startedAt: Date.now() };
    updateItem(current.id, {
      status: "uploading",
      attempts: current.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
    });
    try {
      await api.createCapture(
        current.photos.map((p) => ({
          type: p.type,
          blob: new File(itemDir(current.id), p.file),
          filename: p.file,
        })),
        {
          captureId: current.id,
          media: current.media,
          barcodeHint: current.barcode ?? undefined,
          signal: controller.signal,
          timeoutMs: UPLOAD_TIMEOUT_MS,
        },
      );
      await markUploaded(current);
    } catch (err) {
      const outcome = classify(err, controller.signal.aborted);
      console.warn(`[upload] ${current.id} attempt ${current.attempts + 1} failed:`, outcome.message, err);
      updateItem(current.id, { status: outcome.status, lastError: outcome.message });
      // Offline / server down: stop this pass rather than hammer the network.
      if (outcome.stop) break;
    } finally {
      inFlight = null;
    }
  }
}

function classify(
  err: unknown,
  cancelled: boolean,
): { status: QueuedStatus; message: string; stop: boolean } {
  if (err instanceof SonicApiError) {
    if (err.status === 401) {
      onUnauthorized(); // back to sign-in if the session has really ended
      return { status: "paused", message: "Log in again to resume uploading", stop: true };
    }
    if (err.status === 408 || err.status === 429 || err.status >= 500) {
      return { status: "waiting", message: `Server unavailable (${err.status})`, stop: true };
    }
    // Other 4xx: the server won't ever accept this as-is.
    return { status: "failed", message: errorText(err), stop: false };
  }
  if (err instanceof SonicTimeoutError) {
    return { status: "waiting", message: `${err.message} — will retry`, stop: true };
  }
  if (cancelled) {
    return { status: "waiting", message: "Cancelled a stuck attempt — retrying", stop: false };
  }
  // fetch threw before a response: no connection, DNS, server unreachable, or
  // a client-side problem reading the photos. Show the real message.
  const detail = err instanceof Error && err.message ? err.message : String(err);
  return { status: "waiting", message: `Couldn't reach the server: ${detail}`, stop: true };
}

function errorText(err: SonicApiError): string {
  try {
    const body = JSON.parse(err.message) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // not JSON
  }
  return err.message || `Rejected (${err.status})`;
}

/**
 * Load the queue from disk and start the retry triggers. Idempotent; call once
 * after login.
 */
export async function startUploadQueue() {
  if (started) return;
  started = true;
  await load();

  Network.addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void retryWaiting();
  });
  AppState.addEventListener("change", (s) => {
    if (s === "active") void retryWaiting();
  });
  setInterval(() => {
    if (state.pending.some((p) => p.status === "waiting")) void flush();
  }, RETRY_INTERVAL_MS);

  void retryWaiting();
}

/** Re-arm paused items (e.g. after re-login) and flush. */
function retryWaiting() {
  if (state.pending.some((p) => p.status === "paused") && hasSessionCookie()) {
    setState({
      ...state,
      pending: state.pending.map((p) => (p.status === "paused" ? { ...p, status: "waiting" } : p)),
    });
  }
  return flush();
}

export function useUploadQueue(): QueueState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
