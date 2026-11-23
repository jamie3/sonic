# Sonic — Architecture & Design

**Status:** Draft v1
**Last updated:** 2026-06-09
**Companion to:** [product-description.md](./product-description.md)

---

## 1. Guiding Principles

- **TypeScript everywhere, one workspace** — a **pnpm monorepo** lets mobile,
  web, API, and background apps share types, Zod schemas, and a typed API client from
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
  Postgres so the whole system is just *API + background apps (extractor, matcher) + Postgres + a disk volume*.

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
│  │  API service      │      │  Matcher (apps/matcher)   │   │
│  │  (Fastify, TS)    │      │  (own app + image)        │   │
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
| Deploy | **Docker Compose**, one image per app | `app` (Fastify API + the built SPA), `matcher` and `extractor`, all from the root `Dockerfile` (build targets). |

> The API, matcher and extractor are **separate apps** sharing `@sonic/core`;
> each has its own process and image, so a slow or crashed background job never
> affects the API.

## 3a. Repository Layout (pnpm workspaces)

```
sonic/
├─ pnpm-workspace.yaml
├─ package.json            # workspace root scripts
├─ tsconfig.base.json
├─ docker-compose.yml
├─ apps/
│  ├─ server/              # Fastify API (HTTP layer only) + serves the built SPA
│  ├─ matcher/             # Discogs matching + daily trash purge
│  ├─ extractor/           # reads capture photos → text/fields
│  ├─ discogs/             # Discogs XML dump importer
│  ├─ web/                 # Vite + React SPA
│  └─ mobile/              # Expo / React Native
├─ packages/
│  ├─ core/                # @sonic/core — config, DB, queue, storage, repositories, services, matching
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
- **Library** — cover-art grid; **search/filter** (artist, label, year, tag,
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
All routes are served under the `/api` prefix (e.g. `POST /api/captures`).

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
- **Accounts — Better Auth** (`apps/server/src/auth.ts`, bridged into Fastify
  at `/api/auth/*` by `routes/better-auth.ts`): username + password sign-in
  (username plugin), sign-up, sign-out, change password (with "sign out other
  devices"), sessions in Postgres (`users`, `sessions`, `accounts`,
  `verifications`, snake_case). Passwords are bcrypt. Web uses the same-origin
  session cookie; the Expo app stores the cookie in SecureStore (`@better-auth/expo`)
  and sends it as a header. `requireAuth` resolves the session on every
  protected request (no cookie cache, so revoking a session takes effect
  immediately) and sets `req.authUser`.
- **Invite-only sign-up** (`invites` table): a Better Auth `before` hook on
  `/sign-up/email` atomically claims the `inviteCode` (released if sign-up
  fails, marked used after). The first account on a fresh install needs none.
  Users create codes on the Profile page (`/api/invites`, ≤5 unused, 14-day
  expiry, single use) or with `pnpm invite:create`. Sign-up links:
  `/signup?invite=CODE`.
- **Per-user data:** `capture` and `catalog_entry` have a `user_id`; every
  user-facing repository method takes a required `owner` (a user id, or `null`
  for background jobs), so a missed scope is a type error. Photos are served
  only to their capture's owner. Tags are a shared name list but listed/counted
  per user. The release cache and Discogs data are shared; editing a record's
  details gives that entry its own `edited` copy of the release instead of
  changing the shared row. Trash is per user (the daily expiry purge is global).
- `GET /profile` — the signed-in account plus library counts.
- **Abuse protection** (`@fastify/rate-limit` + Better Auth rate limits +
  `apps/server/src/security/`): every `/api` route is capped per client IP
  (`API_RATE_LIMIT`, default 600/min; `/api/health` exempt); Better Auth caps
  sign-in (10/min), sign-up (5/hour) and change-password (5/min) per IP; 5
  wrong passwords for a username from one IP within 15 min lock that pair out
  for 15 min (429 + `Retry-After`). State-changing `/api` requests whose
  `Origin` is an untrusted site are refused (CSRF backstop; the session cookie
  is also SameSite=Lax). State is in memory — fine for one API process. Behind
  a reverse proxy set `TRUST_PROXY=true` so limits see real client IPs.

**Code layout** — layered MVC on Fastify, dependencies point downward only.
The HTTP layers (routes, schemas, controllers) live in `apps/server/src`;
everything below them lives in `packages/core/src` (`@sonic/core`), shared with
the matcher and extractor:

| Layer | Folder | Responsibility |
|---|---|---|
| Routes | `routes/` | Fastify plugins: URL + method + schema + `preHandler` (auth) → controller method. No logic. |
| Schemas | `schemas/` | The HTTP contract per route, built from `@sonic/shared` zod schemas: params, query, body, responses, OpenAPI tags/summary. |
| Controllers | `controllers/` | HTTP concerns only (status codes, cookies, JWT signing, multipart parsing). Input arrives already validated and typed. |
| Services | `services/` | Business rules. Throw `AppError`s from `errors.ts`; never touch Fastify. |
| Repositories | `repositories/` | All Kysely SQL. `TransactionRunner` gives services transaction-bound repositories. |
| Views | `mappers/` | DB rows → `@sonic/shared` DTOs. |

- **Validation & serialization:** `fastify-type-provider-zod` (v4, zod 3). Fastify
  validates requests and serializes responses against the route schemas, so a
  response that drifts from its contract fails loudly (logged, generic 500)
  and unknown fields are stripped.
- **DI:** `services/index.ts#createServices` wires repositories → services;
  `plugins/services.ts` decorates the Fastify instance with them
  (`app.services`), and route plugins build their controllers from it. The
  matcher (`apps/matcher`) calls `createServices` directly. `buildServer(services)` accepts fakes
  for tests.
- **Errors:** the global handler in `server.ts` returns `{ error }` JSON for
  everything — validation failures add `issues: [{ path, message }]`; unexpected
  errors are logged and returned as a generic 500.
- **API docs:** OpenAPI generated from the schemas (`@fastify/swagger`), Swagger
  UI at `/api/docs`, spec at `/api/docs/json`. On by default outside production;
  set `API_DOCS=true|false` to override.

### 4.3a Extractor (separate app — `apps/extractor`)
Capture lifecycle: `processing` → **extractor** → `review` → (later) **matching**
→ `pending_single | pending_multiple | pending_nomatch` → `approved`.

- Uploads enqueue an `extract` job (pg-boss). The extractor — its own package,
  process (`pnpm dev:extractor`) and Docker service (`--target extractor`) —
  reads the capture's photos, stores the result in `capture_extraction`
  (structured fields: artist, title, label, catalog no., barcode, year, country,
  format, tracklist; plus a verbatim transcription of all legible text), and
  moves the capture to `review` in one transaction.
- **Engines** (`EXTRACTOR_ENGINE`): `claude` (default; `claude-opus-5-5` with
  structured outputs, validated with zod; server-side refusal fallbacks on),
  `ollama` (local vision model, schema-constrained JSON), `tesseract` (offline
  OCR, raw text + barcode only). `EXTRACTOR_MODEL`, `EXTRACTOR_CONCURRENCY`.
- The prompt asks for what is *printed*, not what the model knows about the
  release — the matching stage needs the item's own text.
- Reuses the DB, queue, storage and repositories from `@sonic/core`
  (`@sonic/core/db`, `/queue`, `/repositories`, …).
- Robustness: skips captures no longer `processing` (duplicates, trashed);
  after the final retry it still moves the capture to `review` with the error
  recorded; re-queues captures whose job was lost on start and every 5 min.

### 4.3 Matcher (matching stage + housekeeping — `apps/matcher`)
Its own app, process (`pnpm dev:matcher`) and Docker image (`--target
matcher`): the `recognize` stage — captures in `review` (fed by the extractor)
are matched against Discogs (cascade in §6), writing candidates for approval —
plus the daily trash purge. Long-running external calls never block the API.

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
  keyed by `captures/{captureId}/{photoType}-{attempt}.jpg` (the per-upload
  suffix means files are never overwritten, so they're served with
  `Cache-Control: private, max-age=31536000, immutable`).
- **Later:** `S3Storage` with the same interface; only the wiring changes.
- **One stored format** (`images/processor.ts`, sharp): every upload is
  re-encoded to progressive JPEG (mozjpeg q82, 4:2:0, sRGB), long edge ≤ 2560px,
  auto-rotated from EXIF, all metadata (incl. GPS) stripped; width/height are
  recorded on `capture_photo`. JPEG for maximum compatibility (every browser/OS,
  OCR and vision APIs). Accepts JPEG/PNG/WebP/AVIF; HEIC is rejected (400).

**Mobile offline uploads.** The app saves each capture (photos + manifest)
under its document directory before sending, then a queue retries on
reconnect, app foreground, every 30s, or on demand. The client picks the
capture id and sends it as `captureId`; the API is idempotent on it (a resend
returns the existing capture with 200), so retries never duplicate.

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
  source_tags     text[]       -- source classifications (Discogs genres + styles);
                                --  only used to seed tags on approval
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

tag                            -- owner-defined label: genre, style, category, group…
  id              uuid pk
  name            text         -- unique case-insensitively (index on lower(name))
  created_at      timestamptz

catalog_entry_tag
  catalog_entry_id uuid fk -> catalog_entry (cascade)
  tag_id           uuid fk -> tag (cascade)
  pk(catalog_entry_id, tag_id)
```

Modeling notes:
- **Trash (soft delete).** `catalog_entry.deleted_at` / `capture.deleted_at`
  (migration 003). Trashed rows are excluded from every normal read (catalog,
  search, tag counts, review/unidentified lists, recognition). `DELETE
  /catalog/:id` and `DELETE /captures/:id` move to the trash; `GET /trash`,
  `POST /trash/:kind/:id/restore`, `DELETE /trash/:kind/:id` (forever),
  `DELETE /trash` (empty). Permanent deletion removes rows in a transaction,
  then the photo files, and only ever acts on trashed rows. The **purge** runs
  daily at 03:15 UTC as a pg-boss cron job in the matcher (schedule stored in
  Postgres) and deletes items trashed more than `TRASH_RETENTION_DAYS`
  (default 30) ago. pg-boss rather than `pg_cron` because purging must delete
  image files too, which SQL can't; `pnpm trash:purge` (apps/matcher)
  runs it once for an external cron.
- **Tags replace genres/styles.** They belong to the copy (`catalog_entry`), not
  the shared release. On approval an entry is tagged from its release's
  `source_tags`; afterwards the owner edits them freely (`PATCH /catalog/:id`
  with `tags` replaces the set; `GET /tags` lists tags with counts;
  `GET /catalog/search?tag=` filters). Unused tags are pruned on edit.
- `release` ≈ a Discogs *release*; `catalog_entry` ≈ *your copy* — the
  release/copy split from product doc §4.
- The library = `catalog_entry` joined to `release`. Search runs over `release`
  text fields (Postgres `tsvector` / `pg_trgm` for fuzzy artist/title).
- Multiple-match captures get several `identification_candidate` rows; approval
  promotes the chosen one into a `catalog_entry`.

## 6. Capture Pipeline (extract → match → approve)

```
 upload ─► processing ──(extractor app)──► review ──(matcher)──► pending_single
                          read photos:              search Discogs with       pending_multiple
                          fields + verbatim text    the extracted fields,     pending_nomatch
                          → capture_extraction      quality-check candidates      │
                                                    → candidates + capture_match  │ owner approves
                                                                                  ▼
                                                                              approved  (catalog entry)
```

1. **Extract** (`apps/extractor`, §4.3a): photos → structured fields + all
   legible text → `review`, then queues a `recognize` (matching) job.
2. **Match** (matcher, `services/matching.service.ts`): searches Discogs with the
   extracted fields, strongest identifier first — barcode, then catalog number
   (+ artist), then artist + title only if those found nothing. Searches the
   local data-dump copy (`discogs_*` tables); when that finds nothing and
   `DISCOGS_TOKEN` is set, the same searches run against the Discogs API
   (rate-limited, so only for misses; `DISCOGS_API_FALLBACK=false` turns it
   off). Only releases of the capture's media kind are considered — vinyl
   never matches CD (`matching/media.ts`). The owner can ask for a fresh
   search any time before approval ("Re-scan", `POST /captures/:id/match`).
3. **Quality check** (`matching/score.ts`): every candidate is compared with
   what was read, field by field — barcode and catalog number exact (barcode
   UPC/EAN-normalised), artist / title / label by similarity (case, accents,
   punctuation, "The" ignored), year exact. Weighted into a 0–1 score; each
   field's verdict (match / partial / mismatch / missing) is stored and shown.
   Candidates below 0.4, or with a different title and no matching identifier,
   are dropped. **pending_single** when one remains or the best is ≥ 0.75 and
   ≥ 0.15 ahead; otherwise **pending_multiple**; none → **pending_nomatch**.
4. **No match is fine**: no DISCOGS_TOKEN (outcome `skipped`), nothing found
   (`no_match`), or the search failed after retries (`error`) all end in
   pending_nomatch with the reason in `capture_match`.
5. **Approve** (owner, web Review queue): a candidate (`POST
   /captures/:id/approve`), or the AI's reading corrected in a form (`POST
   /captures/:id/resolve` → a `source: manual` release). Either creates the
   catalog entry and sets `approved`, which removes it from review. "Read photos
   again" (`POST /captures/:id/extract`) restarts at step 1 any time before
   approval.

> **Open:** thresholds (0.4 / 0.75 / 0.15) are first guesses — tune them on real
> captures. Vinyl has many near-identical pressings, so the default stance is to
> show several candidates rather than guess.

## 7. Key Flows

### 7.1 Capture → catalog (sequence)
```
App: take photos (+ maybe barcode)
App → API: POST /captures (multipart photos, barcode_hint)
API: store photos (ImageStorage), insert capture + capture_photo, status=processing
API → pg-boss: enqueue recognize(captureId)
API → App: 201 { captureId, status: processing }
Matcher: run cascade (§6), write candidates, set status pending_*
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

Four services; the app images are build targets of the root `Dockerfile`:

```yaml
services:
  db:      postgres:16                      # pgdata volume
  app:       sonic image (default target), apps/server
             # API under /api + the built web app (static, SPA fallback) on :3005
  matcher:   sonic-matcher image (--target matcher), apps/matcher
             # Discogs matching + trash purge; shares the images volume and env
  extractor: sonic-extractor image (--target extractor), apps/extractor
             # reads capture photos; images volume read-only
```

- The **web app** is built with Vite at image build time and copied to
  `/app/public` (`WEB_DIR`); Fastify serves it with `@fastify/static`. Unknown
  non-`/api` GETs that accept HTML get `index.html`, so client routes survive a
  refresh. One origin means no CORS and no build-time API URL — the web client
  calls `/api` relatively. In dev, Vite proxies `/api` to the server.
- `apps/web` and `apps/server` remain separate workspace packages (different
  runtimes, deps and tsconfig libs); they're combined only in the image.
- **Photos** are protected by the JWT. API calls send it as a Bearer header;
  because `<img>` can't send headers, login also sets an httpOnly, SameSite=Strict
  cookie scoped to `/api/images` only.
- Mobile reaches the API over the LAN or **Tailscale** (fits the existing Mac
  mini setup) at `…:3005/api`.
- OCR (`tesseract`) and any barcode decoder are installed in the image.

## 9. Configuration & Secrets

Environment-driven, so nothing is hard-coded and cloud migration is config-only:
- `DATABASE_URL`
- `JWT_SECRET` (or `BETTER_AUTH_SECRET`), `BETTER_AUTH_URL` — accounts (Better Auth)
- `DISCOGS_TOKEN` (+ user agent), optional `MUSICBRAINZ_*`
- `ANTHROPIC_API_KEY` — for Claude Vision (omit when using local vision)
- `STORAGE_DRIVER` = `disk` | `s3` (+ `IMAGE_DIR` or S3 creds)
- `VISION_DRIVER` = `claude` | `ollama` (+ model/endpoint)

## 10. Migration Path (later, no rewrite)

- **Disk → S3:** implement `S3Storage`, flip `STORAGE_DRIVER`; backfill keys.
- **Local → cloud:** the API and background apps are stateless containers — deploy them to any
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
