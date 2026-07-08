# DisGourd — self-contained image (Node server that serves the built web client).
# Multi-stage: the full node image compiles better-sqlite3 and builds the web
# client; the slim image runs it. Data (DB + uploads) lives on mounted volumes,
# never in the image — see docker-compose.yml.

# --- build: install deps (native better-sqlite3) and build the web client ---
FROM node:22-bookworm AS build
WORKDIR /app
# Install deps first so they cache independently of source changes.
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server install --omit=dev \
 && npm --prefix web install
COPY . .
RUN npm --prefix web run build

# --- runtime: just Node + the server + the built client ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/config/disgourd.db \
    UPLOADS_DIR=/uploads
# Mount points for persistent data (volumes override these at runtime).
RUN mkdir -p /config /uploads
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package*.json ./
EXPOSE 3000
CMD ["node", "server/server.js"]
