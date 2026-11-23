# TODO

Prioritized. Done items are removed — see git history and docs/architecture.md for what's built.

## Hi

- **Trial deployment on the Mac mini, on the internet under a domain** (ops) — run the Docker Compose stack (`db`, `app`, `matcher`, `extractor`) on the Mac mini and reach it at e.g. `https://sonic.<your-domain>`. To decide/do:
  - **Exposure:** Cloudflare Tunnel (no open ports, hides the home IP, free TLS) vs. router port-forward + a reverse proxy (Caddy for automatic HTTPS) + dynamic DNS. Tunnel is the simpler, safer default for a home machine.
  - **Config:** `BETTER_AUTH_URL=https://sonic.<domain>` (origin checks + trusted origins), `TRUST_PROXY=true` (real client IPs for rate limits/lockout), `NODE_ENV=production`, a fresh `BETTER_AUTH_SECRET`, strong `POSTGRES_PASSWORD`; don't publish Postgres's port beyond localhost.
  - **Mobile:** point the app's API URL at the domain (HTTPS) and ship a build that uses it.
  - **Data:** the local Discogs copy is ~26 GB in Postgres (re-run `pnpm discogs:import` on the mini, or dump/restore); move the existing catalog + photos (`IMAGE_DIR` volume) over.
  - **Ops:** start on boot (Docker Desktop login item / `restart: unless-stopped`), nightly `pg_dump` + photo backups off the machine, a health check (`/api/health`) with an uptime monitor, and the Mac set not to sleep.
- **Try multi-user on a phone** (mobile) — the Better Auth sign-in / create-account screens and cookie-authenticated API + photo requests type-check but haven't been run on a device (Expo SDK 58 + `@better-auth/expo`).
- **Try mobile approval on a device** (mobile) — the approve flow (capture sheet + "Ready to approve" on the Capture tab: pick a match, use what was read, re-scan, approve all matched) type-checks but hasn't been run on a phone. Check layout, long button wrapping, and the 409 path (approve the same capture on web first).

## Med

- **Re-check matching as captures accumulate** (matcher) — run `pnpm match:evaluate` (add `--online` to include the API) before/after any change to `MIN_SCORE` / `STRONG_SCORE` / `CLEAR_LEAD` in `packages/core/src/matching/score.ts`. As of 2 approved captures, both rank #1 and nothing is confidently wrong. Decided: a matching year does *not* break original-vs-repress ties (represses reprint the original ℗ year), so those stay "pick one".
- **Android keyboard in the mobile approve form** (mobile) — `automaticallyAdjustKeyboardInsets` is iOS-only; on Android the form fields may sit under the keyboard. Add `KeyboardAvoidingView` or similar.
- **Unwrap API error messages in the client** (api-client) — `SonicApiError.message` is the raw JSON body (`{"error":"…"}`); web login and mobile each parse it themselves. Parse once in `SonicClient.request` so every caller gets the readable message.
- **Password reset + email verification** (api, web, mobile) — Better Auth supports both but needs an email provider (SMTP or Resend). Without it, a forgotten password can only be reset by hand in the database.
- **Change the matched release of an approved record** (web, mobile) — today a wrong match (e.g. an entry approved as the MP3 release instead of the vinyl) can only be fixed by hand in the database. Offer "Change release…" on the record page: pick from the original candidates or search Discogs (same vinyl-only / CD-only rule), then refill details and reset tags.
- **Edit account details** (web) — change email and display name on the Profile page (Better Auth `changeEmail` / `updateUser`). The migrated first account has a placeholder email (`<username>@users.sonic.invalid`) until then.
- **YouTube previews for a record** (api, web, mobile) — the Discogs masters import already stores each master's YouTube videos (`discogs_master.videos`: src, title, duration), so this is mostly UI: show and play them on the record page.
- **Take photos from the web app** (web) — upload/capture flow in the browser (camera via `<input capture>` or getUserMedia), vinyl/CD choice like the phone, posting to the existing `POST /captures`.
- **Automated tests** (core, api) — there are none. Start with the pure, high-value parts: vinyl/CD detection (`matching/media.ts`), scoring and `decide` (`matching/score.ts`), then API routes via `buildServer` + `inject`.

## Low

- **Move to the cloud (long term)** (ops) — after the Mac mini trial. Likely shape: managed Postgres (with room for the ~26 GB Discogs copy, or `DISCOGS_DATABASE_URL` on a separate instance), photos on S3-compatible storage (`STORAGE_DRIVER=s3` — the storage interface exists, the S3 driver doesn't yet), the `app` / `matcher` / `extractor` images on a container host. Before scaling the API past one instance: shared rate-limit/lockout state (see below) and a shared Better Auth rate-limit store.

- **Structured JSON logs everywhere** (matcher, extractor) — the API already logs JSON (pino) in production; the matcher and extractor still `console.log` plain text. Use one shared logger from `@sonic/core`.
- **Shared rate-limit state** (api) — login lockouts and rate-limit counters live in the API process's memory (reset on restart). Fine for one process; move to Redis/Postgres if the API is ever scaled out.
- **Per-app config** (core) — config is one shared schema, so the matcher and extractor require `JWT_SECRET` they never use. Split into shared + per-app schemas.
- **Per-user tag casing** (core) — tag names are a shared list, so the first user to create a tag fixes its capitalisation for everyone (counts and filtering are per user).
- **Image viewer in the review queue** (web) — reuse `ImageLightbox` for the capture photo strip.
- **Split the web bundle** (web) — the production build warns about a >500 kB chunk; lazy-load routes.
- **Housekeeping** — drop the empty `password` database in sonic's Postgres container; fix the `$jx3Z` in `.env` (escape as `$$jx3Z`) that docker compose keeps warning about; use Node 22 (`nvm use`) to match the repo's engines.
