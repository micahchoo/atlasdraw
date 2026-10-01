# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f code/apps/realtime/Dockerfile .
# Same shape as apps/storage/Dockerfile; see the notes there.

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo/code
COPY code/ ./

FROM base AS build
RUN yarn install --immutable
RUN yarn workspace @atlasdraw/realtime build

FROM base AS deps
RUN yarn workspaces focus --production @atlasdraw/realtime

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV ROOMS_DB=/data/rooms.sqlite
COPY --from=deps /repo/code/node_modules ./node_modules
COPY --from=build /repo/code/apps/realtime/dist ./dist
COPY --from=build /repo/code/apps/realtime/package.json ./package.json
# Unprivileged, as in apps/storage/Dockerfile. The directory is made and
# given away before VOLUME, so a new volume starts owned by `node`.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4001
HEALTHCHECK CMD node -e "fetch('http://localhost:4001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
