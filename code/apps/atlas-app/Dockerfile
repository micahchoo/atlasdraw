# syntax=docker/dockerfile:1.7
ARG VITE_BUILD_TARGET=hosted
ARG VITE_STORAGE_BASE_URL=http://localhost:4000
ARG VITE_PMTILES_PATH=/data/world-low-zoom.pmtiles

# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY code/package.json code/yarn.lock ./code/
COPY code/apps/atlas-app/package.json ./code/apps/atlas-app/
COPY code/packages ./code/packages
WORKDIR /repo/code
RUN yarn install --frozen-lockfile
COPY code/apps/atlas-app ./apps/atlas-app
ARG VITE_BUILD_TARGET
ARG VITE_STORAGE_BASE_URL
ARG VITE_PMTILES_PATH
ENV VITE_BUILD_TARGET=$VITE_BUILD_TARGET
ENV VITE_STORAGE_BASE_URL=$VITE_STORAGE_BASE_URL
ENV VITE_PMTILES_PATH=$VITE_PMTILES_PATH
RUN yarn workspace @atlasdraw/atlas-app build

# --- runtime stage ---
FROM nginx:alpine AS runtime
COPY --from=build /repo/code/apps/atlas-app/dist /usr/share/nginx/html
# SPA fallback: serve index.html for any path that isn't a real file.
RUN printf '%s\n' \
    'server {' \
    '  listen 3000;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '  location / { try_files $uri $uri/ /index.html; }' \
    '  location /data/ { add_header Cache-Control "public, max-age=2592000"; }' \
    '}' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
