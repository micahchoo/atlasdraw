# syntax=docker/dockerfile:1.7
# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY code/package.json code/yarn.lock ./code/
COPY code/apps/realtime/package.json ./code/apps/realtime/
COPY code/packages ./code/packages
WORKDIR /repo/code
RUN yarn install --frozen-lockfile
COPY code/apps/realtime ./apps/realtime
RUN yarn workspace @atlasdraw/realtime build

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/code/apps/realtime/dist ./dist
COPY --from=build /repo/code/apps/realtime/package.json ./package.json
COPY --from=build /repo/code/node_modules ./node_modules
EXPOSE 4001
CMD ["node", "dist/index.js"]
