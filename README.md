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
  server/   Fastify API + recognition worker (one image, two commands)
  web/      Vite + React SPA — login, browse/search, advanced features
  mobile/   Expo / React Native — capture-focused
packages/
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
# generate your login password hash:
pnpm install
pnpm --filter @sonic/server hash-password "your-password"   # paste into AUTH_PASSWORD_HASH

docker compose up -d --build             # db + api + worker + web
pnpm --filter @sonic/server migrate      # run DB migrations (first time)
```

- API → http://localhost:3001
- Web → http://localhost:3000

### Development (without Docker for the apps)

```bash
docker compose up -d db        # just Postgres
pnpm migrate                   # migrations
pnpm dev:server                # API + (separately) worker
pnpm dev:web                   # Vite dev server
pnpm dev:mobile                # Expo
```

## Configuration

All config is environment-driven (see [`env.sample`](./env.sample)) so moving
storage to S3 or the whole stack to the cloud is a config change, not a rewrite.
Key vars: `DATABASE_URL`, `JWT_SECRET` / `AUTH_USERNAME` / `AUTH_PASSWORD_HASH`,
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
