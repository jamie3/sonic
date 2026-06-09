# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
# tesseract + a barcode lib's native deps for the recognition worker
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile=false
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @sonic/shared build \
 && pnpm --filter @sonic/server build
# deploy a pruned production node_modules for just the server
RUN pnpm --filter @sonic/server deploy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js", "serve"]
