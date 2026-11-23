# Sonic 🎶

Catalog your vinyl collection by photographing it. Snap a record in the mobile
app → it uploads → a recognition pipeline (barcode → OCR → vision LLM → Discogs)
identifies it → you approve it into a searchable library. Browse and manage the
collection from the web app.

> Personal project. Single-user for now. See [`docs/`](./docs) for the full
> product and architecture design.

## Monorepo layout (pnpm workspaces)

```
apps/
  server/     Fastify API (+ serves the built web app) — HTTP layer only
  matcher/    background app: Discogs matching + daily trash purge
  extractor/  background app: reads capture photos → text/fields
  discogs/    imports the Discogs XML dumps into Postgres (discogs_* tables)
  web/      Vite + React + shadcn/ui SPA — login, browse/search, advanced features
  mobile/   Expo / React Native — capture-focused
packages/
  core/        @sonic/core — config, DB + migrations, queue, storage, repositories,
               services, Discogs lookup + matching (shared by server/matcher/extractor)
  shared/      @sonic/shared — types, Zod schemas, enums (the API contract)
  api-client/  @sonic/api-client — typed client used by web + mobile
docs/
  product-description.md   what we're building
  architecture.md          how it's built
```

## Stack

- **TypeScript** everywhere, shared via the workspace.
- **Server:** Fastify, Kysely + PostgreSQL, pg-boss (in-Postgres job queue).
- **Web:** Vite + React + TanStack Query.
- **Mobile:** Expo (`expo-camera`).
- **Recognition:** barcode + Tesseract OCR → Claude Vision (or a local Ollama
  vision model) → Discogs / MusicBrainz lookup.
- **Storage:** images on disk now, behind an interface for a later S3 swap.

## Quick start (local, Docker)

```bash
cp env.sample .env                       # then fill in secrets
pnpm install
docker compose up -d --build             # db + app + matcher + extractor
pnpm db:migrate                          # run DB migrations (first time)
```

Then open the app and **create an account** — on a fresh install the first
sign-up needs no invite. After that sign-up is invite-only: create codes on the
Profile page (each is single-use, valid 14 days, with a copyable sign-up link)
or with `pnpm invite:create`. Each account has its own catalog.

Everything is served from one origin at http://localhost:3005 — the web app at
`/`, the API under `/api`.

### Deployment model

The root [`Dockerfile`](./Dockerfile) builds one image per app: `app` (the
Fastify server plus the built web app — Fastify serves the SPA's static files
with an `index.html` fallback for client-side routes), `matcher` and
`extractor`, so slow background jobs never block requests. The node apps run
their TypeScript with tsx and share `@sonic/core`; `web` and `server` stay
separate workspace packages, combined only at build time.

### Development (without Docker for the apps)

```bash
nvm use                        # Node 22 (.nvmrc); Expo SDK 58 requires >= 22.13
docker compose up -d db        # just Postgres
pnpm db:migrate                # migrations
pnpm dev                       # all of the below except mobile, in one terminal (starts the db container first)
pnpm dev:server                # API on :3005 — docs at http://localhost:3005/api/docs
pnpm dev:extractor             # extractor app (separate terminal): reads photos → text/fields → "review" (Claude by default)
pnpm dev:matcher               # matcher: Discogs matching stage + daily trash purge (separate terminal)
pnpm dev:web                   # Vite on :5173, proxies /api → :3005
pnpm dev:mobile                # Expo SDK 58 — scan the QR with Expo Go (same Wi-Fi)
```

## Configuration

All config is environment-driven (see [`env.sample`](./env.sample)) so moving
storage to S3 or the whole stack to the cloud is a config change, not a rewrite.
Key vars: `DATABASE_URL`, `JWT_SECRET` (or `BETTER_AUTH_SECRET`), `BETTER_AUTH_URL`,
`DISCOGS_TOKEN`, `VISION_DRIVER` (`claude` | `ollama`) + the matching keys.

## How recognition works

Each capture resolves to **single match** (confirm), **multiple matches**
(you disambiguate), or **no match** (you resolve manually). Nothing is
auto-cataloged — you approve everything, and single-match records support bulk
approval. Details in [`docs/architecture.md`](./docs/architecture.md) §6.

## Status

Scaffolding stage — the structure, contracts, data model, and pipeline shape are
in place; the Discogs client, OCR/barcode decode, and the mobile capture UI are
stubbed with `TODO`s.

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE) — source-available. You may
use, modify, and share Sonic for **noncommercial purposes** (personal, hobby,
research, and noncommercial organizations). **Commercial use — including
companies using or reselling it — is not permitted.** This is intentionally not
an OSI "open source" license, since those cannot restrict commercial use.
