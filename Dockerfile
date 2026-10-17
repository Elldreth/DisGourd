# DisGourd — self-contained image (Node server that serves the built web client).
# Multi-stage: the full node image compiles better-sqlite3 and builds the web
# client; the slim image runs it. Data (DB + uploads) lives on mounted volumes,
# never in the image — see docker-compose.yml.

# --- build: install deps (native better-sqlite3) and build the web client ---
FROM node:22-bookworm AS build
WORKDIR /app
# Install deps first so they cache independently of source changes. `npm ci`
# installs exactly what the lockfiles say (and fails if they're out of date).
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm --prefix server ci --omit=dev \
 && npm --prefix web ci
COPY . .
RUN npm --prefix web run build

# --- runtime: just Node + the server + the built client, run as non-root ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/config/disgourd.db \
    UPLOADS_DIR=/uploads
# Mount points for persistent data (volumes override these at runtime). The app
# itself stays root-owned (read-only to the process); only the data folders
# belong to the runtime user.
RUN mkdir -p /config /uploads && chown node:node /config /uploads
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/package*.json ./
# Never run as root. The image's `node` user (1000:1000) is the default;
# docker-compose.yml sets the user that owns the host folders (Unraid: 99:100).
USER node
EXPOSE 3000
# "healthy" once the server answers. Node 22 has fetch built in.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
