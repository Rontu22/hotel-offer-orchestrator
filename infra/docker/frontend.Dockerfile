# syntax=docker/dockerfile:1
# Build context is the repository root.
FROM node:24-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
# Empty API base = same origin; nginx (here) and CloudFront (in AWS) do the routing.
ENV NEXT_PUBLIC_API_BASE_URL=""
RUN npm run build

# `output: export` produces a pure static bundle, so production needs no Node.
FROM nginx:1.29-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 3000
