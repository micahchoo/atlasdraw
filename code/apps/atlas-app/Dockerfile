# syntax=docker/dockerfile:1.7
ARG VITE_BUILD_TARGET=hosted
ARG VITE_STORAGE_BASE_URL=http://localhost:4000
ARG VITE_PMTILES_PATH=/data/world-low-zoom.pmtiles
ARG VITE_REALTIME_ENABLED=false
ARG VITE_REALTIME_WS_URL=

# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY code/package.json code/yarn.lock ./code/
COPY code/apps/atlas-app/package.json ./code/apps/atlas-app/
COPY code/packages ./code/packages
WORKDIR /repo/code
RUN yarn install --frozen-lockfile
COPY code/apps/atlas-app ./apps/atlas-app
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
FROM nginx:alpine AS runtime
COPY --from=build /repo/code/apps/atlas-app/dist /usr/share/nginx/html
# Serving policy (SPA fallback + cache classes) lives in a real conf file, not
# a printf: the Cache-Control values are reviewable and greppable there.
COPY code/apps/atlas-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
