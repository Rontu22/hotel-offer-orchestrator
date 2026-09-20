# syntax=docker/dockerfile:1
# Build context is the repository root. One image, run twice: each container gets
# its own SUPPLIER_ID, port and DATABASE_URL, so the two suppliers share nothing
# at runtime.
FROM node:24-alpine AS deps
WORKDIR /app
COPY suppliers/package.json suppliers/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY suppliers/ ./
USER node
EXPOSE 4002
CMD ["node", "main.js"]
