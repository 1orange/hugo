# syntax=docker/dockerfile:1
# One image, two roles (ADR 0021): `next start` for web replicas, `node
# dist/worker.mjs` for workers — the command decides, HUGO_ROLE says which.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# No install scripts: the native pieces the app needs (sharp, esbuild, Next's
# SWC) ship as prebuilt optional packages; better-sqlite3 is only for the
# SQLite import script and is never built here.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json next.config.mjs ./
USER node
EXPOSE 3000 9464
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
