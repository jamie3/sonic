import type {
  ApproveRequest,
  BulkApproveRequest,
  BulkApproveResult,
  BulkRematchRequest,
  BulkRematchResult,
  Invite,
  InviteList,
  Profile,
  Capture,
  CatalogEntry,
  CatalogFacets,
  CatalogSearchQuery,
  CatalogSearchResult,
  PhotoType,
  ResolveRequest,
  TagSummary,
  TrashKind,
  TrashList,
  UpdateCatalogEntry,
} from "@sonic/shared";

export interface SonicClientOptions {
  baseUrl: string;
  /**
   * Extra headers for every request — e.g. the mobile app's Better Auth
   * session cookie (`{ Cookie: authClient.getCookie() }`). The web app needs
   * none: the browser sends its same-origin session cookie itself.
   */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** fetch `credentials`; mobile passes "omit" because it sends the cookie by hand. */
  credentials?: RequestCredentials;
}

/**
 * Anything FormData can send as a file: a browser `Blob`/`File`, or an object
 * exposing its bytes — e.g. Expo's `File` from expo-file-system, which is what
 * React Native must use now that Expo's fetch rejects `{ uri, name, type }`.
 */
export type BlobLike = Blob | { bytes(): Promise<Uint8Array>; name?: string; type?: string };

/** One photo in a capture upload. */
export type CaptureUpload = { type: PhotoType; blob: BlobLike; filename: string };

/** Per-request controls. */
export interface RequestControl {
  /** Abort the request from outside (e.g. a manual retry cancelling a stuck attempt). */
  signal?: AbortSignal;
  /** Give up after this many ms. Without one, a dead connection can hang forever. */
  timeoutMs?: number;
}

/** Thrown when a request exceeds `timeoutMs`. */
export class SonicTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "SonicTimeoutError";
  }
}

export interface CreateCaptureOptions extends RequestControl {
  /** Vinyl or CD — matching never pairs one with the other. */
  media?: "vinyl" | "cd";
  barcodeHint?: string;
  /**
   * Client-generated UUID. Resending the same id returns the existing capture
   * instead of creating a duplicate — makes offline retries safe.
   */
  captureId?: string;
}

export class SonicApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SonicApiError";
  }
}

/**
 * Typed client over the Sonic API. Shared by web and mobile so the two clients
 * cannot drift from the server contract (`@sonic/shared`).
 */
export class SonicClient {
  constructor(private opts: SonicClientOptions) {}

  // --- Account ---
  // Sign-in, sign-up, sign-out and change password go through the Better Auth
  // client (`better-auth/react`), which talks to /api/auth/* directly.

  /** The signed-in account and a summary of its library. */
  profile(): Promise<Profile> {
    return this.request("GET", "/profile");
  }

  /** Invite codes I created, and how many more I may create. */
  listInvites(): Promise<InviteList> {
    return this.request("GET", "/invites");
  }

  /** Create a single-use invite code (valid 14 days). */
  createInvite(): Promise<Invite> {
    return this.request("POST", "/invites");
  }

  /** Revoke an unused invite code. */
  revokeInvite(code: string): Promise<void> {
    return this.request("DELETE", `/invites/${encodeURIComponent(code)}`);
  }

  // --- Captures ---
  /** Upload photos for a new capture, one file per PhotoType. */
  async createCapture(photos: CaptureUpload[], opts: CreateCaptureOptions = {}): Promise<Capture> {
    const form = new FormData();
    // Text fields first so the server reads them before the (large) files.
    if (opts.captureId) form.append("captureId", opts.captureId);
    if (opts.media) form.append("media", opts.media);
    if (opts.barcodeHint) form.append("barcodeHint", opts.barcodeHint);
    for (const p of photos) {
      // BlobLike isn't in the DOM typings; Expo's FormData accepts it.
      form.append(p.type, p.blob as Blob, p.filename);
    }
    return this.request("POST", "/captures", {
      form,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });
  }

  listPending(status?: string): Promise<Capture[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/captures${qs}`);
  }

  /** Send a capture back to the extractor to read its photos again. */
  readAgain(id: string): Promise<Capture> {
    return this.request("POST", `/captures/${id}/extract`);
  }

  /** Captures not yet in the catalog: being identified or awaiting review. Newest first. */
  listUnidentified(): Promise<Capture[]> {
    return this.request("GET", "/captures?scope=unidentified");
  }

  getCapture(id: string): Promise<Capture> {
    return this.request("GET", `/captures/${id}`);
  }

  approve(id: string, body: ApproveRequest): Promise<CatalogEntry> {
    return this.request("POST", `/captures/${id}/approve`, { body });
  }

  approveBulk(body: BulkApproveRequest): Promise<BulkApproveResult> {
    return this.request("POST", `/captures/approve-bulk`, { body });
  }

  /** Ask the matcher to search Discogs again for a capture (uses what was already read). */
  rescan(id: string): Promise<Capture> {
    return this.request("POST", `/captures/${id}/match`);
  }

  /** Ask the matcher to search Discogs again for several captures. */
  rescanBulk(body: BulkRematchRequest): Promise<BulkRematchResult> {
    return this.request("POST", `/captures/match-bulk`, { body });
  }

  resolve(id: string, body: ResolveRequest): Promise<CatalogEntry> {
    return this.request("POST", `/captures/${id}/resolve`, { body });
  }

  // --- Catalog ---
  /** Labels, countries and years in my catalog, with counts — for filters. */
  catalogFacets(): Promise<CatalogFacets> {
    return this.request("GET", "/catalog/facets");
  }

  searchCatalog(query: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v != null) as [string, string][],
    );
    return this.request("GET", `/catalog/search?${qs}`);
  }

  getCatalogEntry(id: string): Promise<CatalogEntry> {
    return this.request("GET", `/catalog/${id}`);
  }

  /** All tags in use, with how many catalog entries carry each (sorted by name). */
  listTags(): Promise<TagSummary[]> {
    return this.request("GET", "/tags");
  }

  /** Patch a catalog entry (copy details, tags, and/or release metadata). */
  updateCatalogEntry(id: string, body: UpdateCatalogEntry): Promise<CatalogEntry> {
    return this.request("PATCH", `/catalog/${id}`, { body });
  }

  // --- Trash ---
  /** Move a catalog entry to the trash (restorable until it's purged). */
  trashCatalogEntry(id: string): Promise<void> {
    return this.request("DELETE", `/catalog/${id}`);
  }

  /** Move an unidentified capture to the trash. */
  trashCapture(id: string): Promise<void> {
    return this.request("DELETE", `/captures/${id}`);
  }

  listTrash(): Promise<TrashList> {
    return this.request("GET", "/trash");
  }

  restoreFromTrash(kind: TrashKind, id: string): Promise<void> {
    return this.request("POST", `/trash/${kind}/${id}/restore`);
  }

  /** Permanently delete one trashed item now. */
  deleteForever(kind: TrashKind, id: string): Promise<void> {
    return this.request("DELETE", `/trash/${kind}/${id}`);
  }

  /** Permanently delete everything in the trash. */
  emptyTrash(): Promise<{ entries: number; captures: number }> {
    return this.request("DELETE", "/trash");
  }

  // --- internals ---
  private async request<T>(
    method: string,
    path: string,
    init?: { body?: unknown; form?: FormData } & RequestControl,
  ): Promise<T> {
    const headers: Record<string, string> = { ...(await this.opts.getHeaders?.()) };

    let body: BodyInit | undefined;
    if (init?.form) {
      body = init.form; // browser sets multipart boundary
    } else if (init?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    // One controller fed by the caller's signal and the timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timer = init?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, init.timeoutMs)
      : undefined;
    const onAbort = () => controller.abort();
    if (init?.signal?.aborted) controller.abort();
    init?.signal?.addEventListener("abort", onAbort);

    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(this.opts.credentials ? { credentials: this.opts.credentials } : {}),
      });
    } catch (err) {
      if (timedOut) throw new SonicTimeoutError(init!.timeoutMs!);
      throw err;
    } finally {
      clearTimeout(timer);
      init?.signal?.removeEventListener("abort", onAbort);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new SonicApiError(res.status, text || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
