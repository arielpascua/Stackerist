# syntax=docker/dockerfile:1
# Stackerist: one Node 24 process serving the built client, /ws and GET /healthz on $PORT.
# No BuildKit cache mounts: Railway requires service-scoped mount ids, so plain layers are used.

ARG NODE_IMAGE=node:24-alpine

# ---- base: Node 24 + pnpm pinned by package.json "packageManager" (via corepack) ----
FROM ${NODE_IMAGE} AS base
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable pnpm && corepack install

# ---- manifests: everything pnpm needs to resolve the workspace from the lockfile ----
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml .node-version ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

# ---- build: full install (frozen) and production build ----
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.build.json ./
COPY packages/ packages/
COPY apps/ apps/
# The client imports design/tokens/* (TS + CSS) and design/assets/*.webp (Vite asset imports).
# Nothing else from design/ is needed (concept art and reference screenshots stay out).
COPY design/tokens/ design/tokens/
COPY design/assets/ design/assets/
RUN pnpm build

# ---- prod-deps: runtime dependencies of the server and its workspace packages only ----
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@stackerist/server..."

# ---- runtime: slim image, no pnpm, no dev dependencies, non-root ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/ ./
COPY --from=build /app/packages/engine/dist/ packages/engine/dist/
COPY --from=build /app/packages/protocol/dist/ packages/protocol/dist/
COPY --from=build /app/apps/server/dist/ apps/server/dist/
COPY --from=build /app/apps/client/dist/ apps/client/dist/
USER node
EXPOSE 3000
# Run node directly (not through pnpm) so SIGTERM from the platform reaches the server.
CMD ["node", "apps/server/dist/index.js"]
