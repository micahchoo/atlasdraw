# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f code/apps/storage/Dockerfile .
#
# Yarn 4 installs against the whole workspace graph, so the build copies all
# of code/ (trimmed by /.dockerignore). A second install with
# `workspaces focus --production` gives the runtime only storage's deps.

FROM node:22-bookworm-slim AS base
# better-sqlite3 and a few dev-only workspace deps build native modules.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo/code
COPY code/ ./

FROM base AS build
RUN yarn install --immutable
RUN yarn workspace @atlasdraw/storage build

FROM base AS deps
RUN yarn workspaces focus --production @atlasdraw/storage

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /repo/code/node_modules ./node_modules
COPY --from=build /repo/code/apps/storage/dist ./dist
COPY --from=build /repo/code/apps/storage/package.json ./package.json
# Run as the image's unprivileged `node` user (uid 1000). A new volume at
# /data takes this directory's owner. A volume made by an older image is
# root's: see CHANGELOG "Upgrade" for the one chown it needs.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
HEALTHCHECK CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
