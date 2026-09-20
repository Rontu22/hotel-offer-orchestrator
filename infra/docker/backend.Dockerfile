# syntax=docker/dockerfile:1
# Build context is the repository root. Debian, not Alpine: Temporal's core-bridge
# is a glibc-linked native module and will not load against musl.
FROM node:24-slim AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
RUN npm run build

FROM node:24-slim AS prod-deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Temporal bundles workflow code at worker startup and needs the sources it imports.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/package.json ./
USER node
EXPOSE 3001
# Overridden by the worker service in docker-compose.
CMD ["node", "dist/main.js"]
