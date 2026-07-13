import type {
  ApproveRequest,
  BulkApproveRequest,
  BulkApproveResult,
  Capture,
  CatalogEntry,
  CatalogSearchQuery,
  CatalogSearchResult,
  LoginRequest,
  LoginResponse,
  ResolveRequest,
  UpdateCatalogEntry,
} from "@sonic/shared";

export interface SonicClientOptions {
  baseUrl: string;
  /** Returns the current JWT, or null if not logged in. */
  getToken?: () => string | null;
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

  // --- Auth ---
  login(body: LoginRequest): Promise<LoginResponse> {
    return this.request("POST", "/auth/login", { body });
  }

  me(): Promise<{ username: string }> {
    return this.request("GET", "/auth/me");
  }

  // --- Captures ---
  /** Upload photos for a new capture. `photos` are name/blob pairs by PhotoType. */
  async createCapture(
    photos: { type: string; blob: Blob; filename: string }[],
    barcodeHint?: string,
  ): Promise<Capture> {
    const form = new FormData();
    if (barcodeHint) form.append("barcodeHint", barcodeHint);
    for (const p of photos) form.append(p.type, p.blob, p.filename);
    return this.request("POST", "/captures", { form });
  }

  listPending(status?: string): Promise<Capture[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request("GET", `/captures${qs}`);
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

  resolve(id: string, body: ResolveRequest): Promise<CatalogEntry> {
    return this.request("POST", `/captures/${id}/resolve`, { body });
  }

  // --- Catalog ---
  searchCatalog(query: CatalogSearchQuery): Promise<CatalogSearchResult> {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v != null) as [string, string][],
    );
    return this.request("GET", `/catalog/search?${qs}`);
  }

  getCatalogEntry(id: string): Promise<CatalogEntry> {
    return this.request("GET", `/catalog/${id}`);
  }

  /** Update a catalog entry's note. Pass `notes: null` to clear it. */
  updateCatalogEntry(id: string, body: UpdateCatalogEntry): Promise<CatalogEntry> {
    return this.request("PATCH", `/catalog/${id}`, { body });
  }

  // --- internals ---
  private async request<T>(
    method: string,
    path: string,
    init?: { body?: unknown; form?: FormData },
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.opts.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (init?.form) {
      body = init.form; // browser sets multipart boundary
    } else if (init?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    const res = await fetch(`${this.opts.baseUrl}${path}`, { method, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new SonicApiError(res.status, text || res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
