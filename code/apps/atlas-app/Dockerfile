# syntax=docker/dockerfile:1.7
ARG VITE_BUILD_TARGET=hosted
ARG VITE_STORAGE_BASE_URL=http://localhost:4000
ARG VITE_PMTILES_PATH=/data/world-low-zoom.pmtiles
ARG VITE_REALTIME_ENABLED=false
ARG VITE_REALTIME_WS_URL=

# --- build stage ---
# Build from the repo root:  docker build -f code/apps/atlas-app/Dockerfile .
# Yarn 4 installs against the whole workspace graph, so copy all of code/
# (trimmed by /.dockerignore).
# The build stage runs on the builder's own platform: its output is static
# files, so a multi-platform build needs no emulated Node.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo/code
COPY code/ ./
RUN yarn install --immutable
ARG VITE_BUILD_TARGET
ARG VITE_STORAGE_BASE_URL
ARG VITE_PMTILES_PATH
ARG VITE_REALTIME_ENABLED
ARG VITE_REALTIME_WS_URL
ENV VITE_BUILD_TARGET=$VITE_BUILD_TARGET
ENV VITE_STORAGE_BASE_URL=$VITE_STORAGE_BASE_URL
ENV VITE_PMTILES_PATH=$VITE_PMTILES_PATH
ENV VITE_REALTIME_ENABLED=$VITE_REALTIME_ENABLED
ENV VITE_REALTIME_WS_URL=$VITE_REALTIME_WS_URL
RUN yarn workspace @atlasdraw/atlas-app build

# --- runtime stage ---
# nginx-unprivileged runs as uid 101 and listens on 3000 without root.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=build /repo/code/apps/atlas-app/dist /usr/share/nginx/html
# Serving policy (SPA fallback + cache classes) lives in a real conf file, not
# a printf: the Cache-Control values are reviewable and greppable there.
COPY code/apps/atlas-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
