# DisGourd 🥒

A self-hostable, Discord-style chat app for you and your friends. Run it on your
own machine — real-time text channels, servers, file sharing, presence — with
**no external services to install**. Data lives in a single SQLite file.

- **Backend:** Node.js + SQLite (`better-sqlite3`), no database server required
- **Frontend:** React + Vite + Tailwind
- **One command to run**, one port, one small dependency footprint

## Requirements

- **Node.js 18 or newer** (includes `npm`). Check with `node -v`.

That's it — no MongoDB, Redis, Docker, or cloud accounts needed.

## Quick start

```bash
# 1. Install dependencies and build the web client
npm run setup

# 2. Start the server
npm start
```

Then open **http://localhost:3000** in your browser, register an account, and
create your first server. 🎉

On first run the server generates a strong secret key automatically (saved to
`server/.jwt-secret`) — you don't need to configure anything to get going.

## Running it for your friends

DisGourd serves everything (API, WebSocket, and the web UI) on a single port, so
your friends just need to reach that port on your machine:

- **Same network (LAN):** share your machine's local IP, e.g.
  `http://192.168.1.42:3000`.
- **Over the internet:** put it behind a reverse proxy (Caddy, nginx, or a
  tunnel like Cloudflare Tunnel / Tailscale) that terminates **HTTPS**. Browsers
  require secure origins for many features, and you don't want passwords sent in
  the clear. The app automatically uses secure WebSockets (`wss://`) when served
  over HTTPS.

Set a fixed secret in production so tokens stay valid across restarts and
deployments (see below).

## Configuration

All settings are optional and provided via environment variables (or
`server/config.json` for `port`/`jwtSecret`):

| Variable           | Default                  | Description                                        |
| ------------------ | ------------------------ | -------------------------------------------------- |
| `PORT`             | `3000`                   | Port the server listens on                         |
| `JWT_SECRET`       | auto-generated           | Secret used to sign login tokens                   |
| `DB_PATH`          | `server/db/disgourd.db`  | SQLite database file location                      |
| `UPLOADS_DIR`      | `uploads/`               | Where uploaded files are stored                    |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB)       | Maximum upload size                                |
| `WEB_DIST`         | `web/dist`               | Location of the built web client                   |

Example (Linux/macOS):

```bash
PORT=8080 JWT_SECRET="a-long-random-string" npm start
```

## Development

Run the backend and the hot-reloading frontend in two terminals:

```bash
npm run dev:server   # API + WebSocket on http://localhost:3000
npm run dev:web      # Vite dev server on http://localhost:5173 (proxies to :3000)
```

Open **http://localhost:5173** while developing. Run the test suite with:

```bash
npm test
```

## Data & backups

Everything your community creates lives in two places:

- **`server/db/disgourd.db`** — accounts, servers, channels, messages, friends
- **`uploads/`** — uploaded images and files

To back up, stop the server and copy both. To reset, delete them.

## Security notes

- Passwords are hashed with **scrypt** and never stored in plain text.
- Login tokens are signed JWTs that expire after 7 days.
- Auth endpoints are rate-limited against brute-force attempts.
- Uploaded files get randomized storage paths and are served with
  `X-Content-Type-Options: nosniff`; executable types are rejected.
- Keep `server/.jwt-secret` (and any `JWT_SECRET` you set) private — anyone with
  it can forge logins. It is gitignored by default.

## Project structure

```
server/    Node.js API + WebSocket server, SQLite storage
web/       React + Vite + Tailwind web client
uploads/   Uploaded files (created at runtime, gitignored)
```

## Servers & invites

Anyone can create a server (they become its owner) with the **+** in the left
rail. To bring friends in, open the server menu (click the server name) →
**Invite people** to mint an invite code, and share it. They join by entering
the code under **Join a server** (the ⤵ button in the rail). You only see
servers you own or have joined, and only members can read a server's channels.

## Roadmap

Working today: accounts with avatars, servers with ownership and invite codes,
text channels, real-time messaging with edit/delete, emoji reactions, typing
indicators, unread badges, direct messages, message search, file sharing,
presence, and a per-server member list. Planned next: mentions, richer roles,
and — later — voice/video.
