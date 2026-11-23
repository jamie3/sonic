# One image per app. The node apps run their TypeScript source with tsx and
# share @sonic/core / @sonic/shared as workspace packages (no compile step).
#   docker build .                      → API + built web app (default)
#   docker build --target matcher .     → Discogs matching + trash purge
#   docker build --target extractor .   → photo reading
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/

# ---- web app build (served by the API) ----
FROM base AS web
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@sonic/web..."
COPY packages/shared ./packages/shared
COPY packages/api-client ./packages/api-client
COPY apps/web ./apps/web
RUN pnpm --filter @sonic/web build

# ---- matcher: Discogs matching for captures in review + daily trash purge ----
FROM base AS matcher
COPY apps/matcher/package.json apps/matcher/
RUN pnpm install --frozen-lockfile --prod --filter "@sonic/matcher..."
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/matcher ./apps/matcher
ENV NODE_ENV=production
WORKDIR /app/apps/matcher
CMD ["node", "--import", "tsx", "src/main.ts"]

# ---- extractor: reads capture photos → text/fields → "review" ----
FROM base AS extractor
COPY apps/extractor/package.json apps/extractor/
RUN pnpm install --frozen-lockfile --prod --filter "@sonic/extractor..."
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/extractor ./apps/extractor
ENV NODE_ENV=production
WORKDIR /app/apps/extractor
CMD ["node", "--import", "tsx", "src/main.ts"]

# ---- API + built web app on one port (default target: keep this stage last) ----
FROM base AS server
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter "@sonic/server..."
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/server ./apps/server
COPY --from=web /app/apps/web/dist ./public
ENV NODE_ENV=production \
    WEB_DIR=/app/public
WORKDIR /app/apps/server
EXPOSE 3005
CMD ["node", "--import", "tsx", "src/main.ts"]
