# Sonic — Architecture & Design

**Status:** Draft v1
**Last updated:** 2026-06-09
**Companion to:** [product-description.md](./product-description.md)

---

## 1. Guiding Principles

- **TypeScript everywhere, one workspace** — a **pnpm monorepo** lets mobile,
  web, API, and worker share types, Zod schemas, and a typed API client from
  `packages/`. The contract is defined once and imported everywhere.
- **Local-first, container-deployed** — runs on a single machine via Docker
  Compose now (Mac mini / dev machine). Designed so individual pieces (storage,
  hosting) can move to the cloud later without a rewrite.
- **Pluggable seams** — image storage and the vision model sit behind interfaces
  so we can swap disk → S3 and Claude → a local LLM without touching callers.
- **Human-gated catalog** — identification is a head-start; the owner approves
  everything (see product doc §5–6). The architecture reflects this with an
  explicit capture → pending → approved lifecycle.
- **Minimal moving parts** — no Redis, no extra brokers. The job queue lives in
  Postgres so the whole system is just *API + worker + Postgres + a disk volume*.

## 2. High-Level Architecture

```
┌─────────────────────────┐   ┌─────────────────────────┐
│  Mobile App (Expo, TS)   │   │  Web App (Vite+React,TS) │
│  - capture-focused       │   │  - login, browse/search  │
│  - photos + barcode scan │   │  - advanced features      │
│  - approval queue        │   │  - bulk approval, admin   │
└───────────┬─────────────┘   └────────────┬─────────────┘
            │   both import @sonic/api-client + @sonic/shared
            │ HTTPS / REST (JWT)            │
            │  (LAN or Tailscale)           │
            └──────────────┬────────────────┘
                           │
┌───────────▼──────────────────────────────────────────────┐
│  Docker Compose host (Mac mini / dev machine)              │
│                                                            │
│  ┌──────────────────┐      ┌──────────────────────────┐   │
│  │  API service      │      │  Worker (recognition)     │   │
│  │  (Fastify, TS)    │      │  (same image, queue mode) │   │
│  │  - upload images  │      │  - barcode / OCR          │   │
│  │  - enqueue jobs   │─────▶│  - vision LLM fallback    │   │
│  │  - approval API   │ jobs │  - Discogs lookup         │   │
│  │  - search/browse  │      │  - writes candidates      │   │
│  └────────┬──────────┘      └────────────┬─────────────┘   │
│           │                              │                 │
│           │      ┌───────────────────────▼──────────────┐  │
│           └─────▶│  PostgreSQL (catalog + job queue)     │  │
│                  └──────────────────────────────────────┘  │
│           │                                                │
│  ┌────────▼─────────┐                                      │
│  │  Image storage    │  LocalDiskStorage now (mounted vol) │
│  │  (disk volume)    │  → S3Storage later (same interface) │
│  └───────────────────┘                                     │
└────────────────────────────────────────────────────────────┘
            │ outbound HTTPS
            ▼
   External APIs: Discogs (primary), MusicBrainz (fallback),
                  Claude Vision API (or local Ollama vision model)
```

## 3. Technology Choices

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | **pnpm workspaces** | Share `@sonic/shared` (types/schemas) and `@sonic/api-client` across apps; one install, hoisted deps. |
| Mobile | **Expo (React Native) + TypeScript** | Best-in-class camera & barcode support (`expo-camera`), OTA updates, easy local builds. Capture-focused client. |
| Web | **Vite + React + TypeScript (SPA)** | Talks to the same Fastify API; reuses the shared client. Home for advanced features (bulk ops, admin, richer browsing). Keeps one backend rather than adding a Next.js server. |
| Client data | **TanStack Query** (web + mobile) | Caching, background refetch, optimistic approvals. |
| Auth | **JWT** (username/password login) | Single user seeded from env now; web needs a login. Same token works for mobile. Upgradable to multi-user. |
| API | **Fastify + TypeScript** | Fast, light, first-class TS, simple file uploads; lower ceremony than Nest for a single-user app. |
| Validation | **Zod** | Shared schemas between API and (optionally) mobile; validates Discogs/LLM responses. |
| DB access | **Kysely + PostgreSQL** | Type-safe SQL query builder (not a heavy ORM) — close to SQL, fully typed; Postgres gives us JSONB for raw Discogs payloads. Schema migrations via Kysely's `Migrator`; DB types via `kysely-codegen` or hand-written. |
| Job queue | **pg-boss** | Durable background jobs *inside Postgres* — no Redis, no extra container. |
| Vision | **Claude Vision API** behind a `VisionExtractor` interface | Strong structured extraction from messy photos; swappable for a local Ollama vision model (e.g. Qwen2-VL / Llama 3.2 Vision). |
| Barcode | On-device (`expo-camera`) + server-side fallback | Cheapest, most reliable signal when a barcode exists. |
| OCR | **Tesseract** (server) | Free, local, good enough for catalog numbers / label text. |
| Deploy | **Docker Compose** | One command to bring up api + worker + db; reproducible. |

> The API and worker are the **same image** run with different commands
> (`serve` vs `work`), so there's one build to maintain.

## 3a. Repository Layout (pnpm workspaces)

```
sonic/
├─ pnpm-workspace.yaml
├─ package.json            # workspace root scripts
├─ tsconfig.base.json
├─ docker-compose.yml
├─ apps/
│  ├─ server/              # Fastify API + recognition worker (one image)
│  ├─ web/                 # Vite + React SPA
│  └─ mobile/              # Expo / React Native
├─ packages/
│  ├─ shared/              # @sonic/shared — types, Zod schemas, enums (the contract)
│  └─ api-client/          # @sonic/api-client — typed client over the API
└─ docs/
```

- **`@sonic/shared`** is the single source of truth for domain types (capture
  status, condition grades), the `ReleaseMatch`/`ReleaseDetail` shapes, and the
  request/response DTOs as Zod schemas. The server validates with them; clients
  infer their types from them.
- **`@sonic/api-client`** wraps `fetch` with typed methods (`createCapture`,
  `listPending`, `approveBulk`, `searchCatalog`, `login`, …) and is consumed by
  both web and mobile, so the two clients can't drift from the API.

## 4. Components

### 4.1 Mobile App (Expo / React Native)
- **Capture screen** — guided multi-photo capture (front, back, label A/B).
  Runs on-device barcode detection during capture; if a barcode is found it's
  attached to the capture as a strong hint.
- **Upload** — photos upload to the API in the background with a local queue so
  capture works offline and syncs when connectivity returns.
- **Pending Approval queue** — lists captures grouped by outcome (single /
  multiple / no-match). Supports **bulk select + approve** for single-match
  records; multiple/no-match items open a disambiguation or manual-entry screen.
- **Library** — cover-art grid; **search/filter** (artist, label, year, genre,
  location, condition) served by the catalog API.
- Configurable **API base URL**; logs in and stores the **JWT** in secure
  storage.

### 4.1b Web App (Vite + React SPA)
The richer client, for when you're at a desk rather than holding records:
- **Login** (username/password → JWT, kept in memory + refresh).
- **Library browsing & search** with bigger layouts, sorting, and filters.
- **Bulk approval** of the pending queue (easier on a large screen).
- **Advanced features** home: editing metadata, managing locations/shelves,
  duplicate review, exports — the things that are awkward on a phone.
- Talks to the same Fastify API via `@sonic/api-client`; no server of its own.

### 4.2 API Service (Fastify)
Responsibilities:
- `POST /captures` — create a capture; accept uploaded photos (multipart),
  persist them via the storage interface, record `capture_photo` rows, and
  enqueue a `recognize` job.
- `GET /captures?status=pending` — the approval queue.
- `POST /captures/:id/approve` — approve a single match into a `catalog_entry`.
- `POST /captures/approve-bulk` — approve many single-match captures at once.
- `POST /captures/:id/resolve` — owner picks a candidate (multiple-match) or
  supplies manual metadata (no-match).
- `GET /catalog`, `GET /catalog/:id` — browse/search the library.
- `GET /catalog/search?q=` — full-text search over cached release metadata.
- Static-but-protected **image serving** (or signed local paths) for the app.
- `POST /auth/login` — username/password → JWT; `GET /auth/me`.
- **Auth:** JWT verified on every protected request (Fastify `preHandler`). The
  single user's credentials are seeded from env (`AUTH_USERNAME`,
  `AUTH_PASSWORD_HASH`, `JWT_SECRET`). A `users` table can replace the seeded
  account when multi-user arrives — the token flow stays the same.

### 4.3 Recognition Worker
A separate process (same image) consuming `recognize` jobs from pg-boss. Runs the
cascade in §6 and writes `identification_candidate` rows + sets the capture's
status. Long-running external calls (Claude, Discogs) never block the API.

### 4.4 Image Storage (pluggable)
```ts
interface ImageStorage {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  url(key: string): string;        // local path / signed URL
  delete(key: string): Promise<void>;
}
```
- **Now:** `LocalDiskStorage` writing to a mounted volume (e.g. `/data/images`),
  keyed by `captures/{captureId}/{photoType}.jpg`.
- **Later:** `S3Storage` with the same interface; only the wiring changes.

### 4.5 Metadata Sources (pluggable)
```ts
interface MetadataSource {
  searchByBarcode(barcode: string): Promise<ReleaseMatch[]>;
  searchByCatalogNumber(cat: string): Promise<ReleaseMatch[]>;
  searchByText(q: { artist?: string; title?: string; label?: string }): Promise<ReleaseMatch[]>;
  getRelease(sourceId: string): Promise<ReleaseDetail>;
}
```
- **DiscogsSource** (primary), **MusicBrainzSource** (fallback/cross-check).
- Results are normalized to a common `ReleaseMatch` shape and **cached into the
  `release` table** so the catalog is self-contained and the app can search
  offline-of-Discogs.

## 5. Data Model

PostgreSQL, accessed via Kysely (migrations with Kysely's `Migrator`). Core tables:

```
release                       -- cached canonical metadata from a source
  id              uuid pk
  source          text         -- 'discogs' | 'musicbrainz'
  source_id       text         -- e.g. Discogs release id
  artist          text
  title           text
  label           text
  catalog_number  text
  barcode         text
  year            int
  country         text
  format          text         -- e.g. 'Vinyl, 12", 33 ⅓ RPM'
  genres          text[]
  styles          text[]
  cover_url       text
  tracklist       jsonb
  raw             jsonb         -- full source payload
  cached_at       timestamptz
  unique(source, source_id)

capture                        -- one scan session for one physical record
  id              uuid pk
  status          text         -- 'processing' | 'pending_single'
                                --  | 'pending_multiple' | 'pending_nomatch'
                                --  | 'approved' | 'skipped'
  barcode_hint    text         -- from on-device scan, if any
  created_at      timestamptz
  resolved_at     timestamptz

capture_photo
  id              uuid pk
  capture_id      uuid fk -> capture
  type            text         -- 'front' | 'back' | 'label_a' | 'label_b' | 'spine'
  storage_key     text         -- key into ImageStorage
  width/height    int
  created_at      timestamptz

identification_candidate       -- what the pipeline proposed
  id              uuid pk
  capture_id      uuid fk -> capture
  release_id      uuid fk -> release
  method          text         -- 'barcode' | 'ocr' | 'vision' | 'manual'
  rank            int
  extracted       jsonb        -- fields the pipeline pulled from photos
  created_at      timestamptz

catalog_entry                  -- the owner-approved copy that lives in the library
  id              uuid pk
  capture_id      uuid fk -> capture (nullable for hand-added)
  release_id      uuid fk -> release
  condition       text         -- e.g. 'NM' | 'VG+' ...
  location        text         -- shelf / crate
  purchase_price  numeric
  purchase_date   date
  notes           text
  approved_at     timestamptz
  created_at      timestamptz
```

Modeling notes:
- `release` ≈ a Discogs *release*; `catalog_entry` ≈ *your copy* — the
  release/copy split from product doc §4.
- The library = `catalog_entry` joined to `release`. Search runs over `release`
  text fields (Postgres `tsvector` / `pg_trgm` for fuzzy artist/title).
- Multiple-match captures get several `identification_candidate` rows; approval
  promotes the chosen one into a `catalog_entry`.

## 6. Recognition Pipeline (the cascade)

Triggered by a `recognize` job after upload. Each stage tries to produce a
confident set of `ReleaseMatch`es; we stop at the first stage that yields a clean
result, but always end by resolving against the metadata sources.

```
            ┌──────────────────────────────┐
            │ 1. Barcode                    │  on-device hint, else decode
            │    barcode → Discogs lookup   │  from photo (zxing/quagga)
            └───────────────┬──────────────┘
                 hit?        │ no / none
            ┌────────────────▼─────────────┐
            │ 2. OCR (Tesseract)            │  read catalog # + label text
            │    catalog# → Discogs lookup  │  from label/back photos
            └───────────────┬──────────────┘
                 hit?        │ no / weak
            ┌────────────────▼─────────────┐
            │ 3. Vision LLM (Claude)        │  extract {artist,title,label,cat#}
            │    behind VisionExtractor     │  as structured JSON
            └───────────────┬──────────────┘
                            │ extracted fields
            ┌────────────────▼─────────────┐
            │ 4. Metadata search            │  Discogs (then MusicBrainz)
            │    by fields → ReleaseMatch[] │  normalize + cache to `release`
            └───────────────┬──────────────┘
                            │
            ┌────────────────▼─────────────┐
            │ 5. Resolve outcome            │
            │   1 match  → pending_single   │
            │   >1 match → pending_multiple │
            │   0 match  → pending_nomatch  │
            └──────────────────────────────┘
```

- **Barcode** is the strongest signal — captured on-device when possible, with a
  server-side decode fallback from the uploaded photos.
- **OCR** targets the catalog number (very distinctive for vinyl) and label name.
- **Vision LLM** is the fallback for messy/handwritten/obscured cases. The
  `VisionExtractor` interface lets us run **Claude Vision** or a **local Ollama
  vision model** (Qwen2-VL, Llama 3.2 Vision, moondream) via config — useful for
  cost control and fully-offline operation.
- **No scoring** is surfaced. The outcome is purely *how many releases matched*
  (product doc §6.3): one → confirm, many → disambiguate, none → manual.

> **Match criteria (open):** how close two Discogs pressings must be before we
> show both for disambiguation vs. collapse to one. For vinyl this matters a lot —
> one release often has many near-identical pressings. Default stance: **prefer
> showing candidates over guessing** (product doc §6 note).

## 7. Key Flows

### 7.1 Capture → catalog (sequence)
```
App: take photos (+ maybe barcode)
App → API: POST /captures (multipart photos, barcode_hint)
API: store photos (ImageStorage), insert capture + capture_photo, status=processing
API → pg-boss: enqueue recognize(captureId)
API → App: 201 { captureId, status: processing }
Worker: run cascade (§6), write candidates, set status pending_*
App: poll/refresh GET /captures?status=pending  (or push later)
Owner: approve single / choose / manual-resolve
App → API: POST approve | resolve
API: create catalog_entry, set capture.status=approved
```

### 7.2 Bulk approval
```
App → API: GET /captures?status=pending_single
Owner: select many → POST /captures/approve-bulk { captureIds[] }
API: for each, create catalog_entry (only pending_single eligible),
     set approved; return per-id results
```

### 7.3 Browse / search
```
App → API: GET /catalog/search?q=...&filters
API: query catalog_entry ⋈ release (tsvector + pg_trgm), paginated
API → App: results with cover_url, key metadata
```

## 8. Deployment (Docker Compose)

Three services from two images (api/worker share one):

```yaml
# sketch — not final
services:
  db:
    image: postgres:16
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    environment: [ POSTGRES_PASSWORD, POSTGRES_DB=sonic ]
  api:
    build: ./server
    command: ["node", "dist/main.js", "serve"]
    ports: [ "3005:3005" ]
    volumes: [ "images:/data/images" ]
    environment: [ DATABASE_URL, API_TOKEN, DISCOGS_TOKEN, ANTHROPIC_API_KEY,
                   STORAGE_DRIVER=disk, IMAGE_DIR=/data/images ]
    depends_on: [ db ]
  worker:
    build: ./apps/server
    command: ["node", "dist/main.js", "work"]
    volumes: [ "images:/data/images" ]
    environment: [ DATABASE_URL, DISCOGS_TOKEN, ANTHROPIC_API_KEY, VISION_DRIVER ]
    depends_on: [ db ]
  web:
    build: ./apps/web        # built static SPA served by nginx (or vite preview)
    ports: [ "3000:80" ]
    environment: [ VITE_API_URL ]   # baked at build; points at the API
volumes: { pgdata: {}, images: {} }
```

- The **web app** is a static build (nginx). Mobile and web both reach the API
  over the LAN or **Tailscale** (fits the existing Mac mini setup). API base URL
  is configured per client.
- OCR (`tesseract`) and any barcode decoder are installed in the server image.

## 9. Configuration & Secrets

Environment-driven, so nothing is hard-coded and cloud migration is config-only:
- `DATABASE_URL`
- `JWT_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` — single-user login
- `DISCOGS_TOKEN` (+ user agent), optional `MUSICBRAINZ_*`
- `ANTHROPIC_API_KEY` — for Claude Vision (omit when using local vision)
- `STORAGE_DRIVER` = `disk` | `s3` (+ `IMAGE_DIR` or S3 creds)
- `VISION_DRIVER` = `claude` | `ollama` (+ model/endpoint)

## 10. Migration Path (later, no rewrite)

- **Disk → S3:** implement `S3Storage`, flip `STORAGE_DRIVER`; backfill keys.
- **Local → cloud:** the API/worker are stateless containers — deploy them to any
  container host; point `DATABASE_URL` at managed Postgres (e.g. Neon).
- **Claude → local LLM (or vice-versa):** flip `VISION_DRIVER`.
- **Single- → multi-user:** add a `user_id` column to `capture`/`catalog_entry`
  and replace the static token with real auth.

## 11. Remaining Open Questions

1. **Match criteria** — single-vs-multiple threshold for Discogs pressings (§6).
2. **Push vs. poll** — does the app poll the pending queue, or do we add push
   (the existing **ntfy** setup could notify when recognition finishes)?
3. **Local vision model** — which Ollama model is "good enough" to be the Claude
   alternative, and is the Mac mini's hardware sufficient for it?
4. **Image serving/auth** — signed local URLs vs. token-guarded streaming
   endpoint for photos.
5. **Barcode decode location** — rely on on-device only, or always also attempt
   server-side decode for robustness?

---

*Next step: turn this into a concrete repo skeleton (server + mobile + compose)
and the initial Kysely migrations + DB types, or drill into any component above.*
