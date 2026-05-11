# syntax=docker/dockerfile:1.7
# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /repo
# Need build deps for better-sqlite3 native module
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY code/package.json code/yarn.lock ./code/
COPY code/apps/storage/package.json ./code/apps/storage/
COPY code/packages ./code/packages
WORKDIR /repo/code
RUN yarn install --frozen-lockfile
COPY code/apps/storage ./apps/storage
RUN yarn workspace @atlasdraw/storage build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy compiled output + production node_modules.
COPY --from=build /repo/code/apps/storage/dist ./dist
COPY --from=build /repo/code/apps/storage/package.json ./package.json
COPY --from=build /repo/code/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/index.js"]
