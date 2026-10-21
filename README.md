<p align="center">
  <img src="design/brand/disgourd-app-icon.svg" alt="DisGourd" width="96" height="96" />
</p>

<h1 align="center">DisGourd</h1>

<p align="center">
  <a href="https://github.com/Elldreth/DisGourd/actions/workflows/ci.yml"><img src="https://github.com/Elldreth/DisGourd/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
</p>

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

**Windows (no terminal needed):** double-click **`setup.bat`** once, then
**`run.bat`** to start it (run.bat also sets itself up on first launch).

**Any OS (terminal):**

```bash
npm run setup   # install dependencies and build the web client
npm start       # start the server
```

## Updating

New code has to be **rebuilt** — `npm start` only serves the existing build, it
doesn't recompile the web app. After you pull a new version:

**Windows:** double-click **`update.bat`** (it pulls, installs, and rebuilds),
then start it again with `run.bat`.

**Any OS (terminal):**

```bash
git pull
npm run setup   # or: npm run build
npm start
```

Restart the server afterwards so any changes take effect, and hard-refresh your
browser (Ctrl/Cmd+Shift+R) to drop the old cached bundle.

Then open **http://localhost:3000**. The **first time** you visit a brand-new
server, a short **setup wizard** appears: create the first account — it becomes
the **owner and site admin** — and optionally name your first community. After
that, everyone else uses the normal sign-in screen.

The wizard asks for a **setup code** first. The server prints it when it
starts with no accounts (`First run: … Your setup code is …`; with Docker,
`docker logs disgourd`) and saves it in `.setup-code` next to the database
(`server/` locally, `/config` in Docker). That way nobody who finds a fresh
server before you can make themselves its admin. The code is deleted once the
first account exists. Set `SETUP_CODE` to choose your own.

On first run the server also generates a strong secret key automatically (saved
to `server/.jwt-secret`), so there's nothing to configure to get going.
Registration is **open** by default (so you can create that first account); lock
it down anytime in **Settings → Registration &amp; access**.

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

Each person can pick their own **microphone and speaker** for voice under
**Settings** (click your name in the bottom-left) → **Voice & audio**, including
a mic test — independent of the operating-system default.

## Run with Docker (always-on server / Unraid)

A `Dockerfile` and a generic `docker-compose.yml` are included. From a checkout
on the server:

```bash
docker compose up -d --build
docker logs disgourd     # the one-time setup code for the first account
```

The root `docker-compose.yml` keeps data in `./data`, runs read-only with no
capabilities, and publishes no port: put a reverse proxy or tunnel in front.
Optional recipes, each with a "change these" list, are in `deploy/`:

- `deploy/unraid-tunnel/`: Unraid behind a Cloudflare Tunnel (no open ports),
  with a LAN egress firewall rule.
- `deploy/swag/`: Unraid (or any Docker host) behind SWAG / nginx.
- `deploy/linux-vps/`: a Linux VPS behind Caddy or a Cloudflare Tunnel.

**Your own setup** (real domain, tokens, IPs, paths, the compose file you
actually run) belongs in a `local/` folder at the top of your checkout. Git
ignores it, so it never gets committed or pushed.

Data lives on **mounted volumes**, never in the image, and the DB and uploads
are split on purpose:

- **DB → fast local storage (SSD/cache).** SQLite wants low-latency, non-network
  storage — don't put it on a spanning array through a FUSE mount (e.g. Unraid's
  `/mnt/user/...`); use a direct disk/cache path there.
- **Uploads → wherever you have space** (that's what grows).

To put the data elsewhere, change the volume paths:

```yaml
environment:
  - REGISTRATION_MODE=code              # people need a code you make in Settings
volumes:
  - /path/on/ssd/disgourd:/config       # DB   (DB_PATH=/config/disgourd.db)
  - /path/on/big/storage:/uploads       # uploads (UPLOADS_DIR=/uploads)
```

The container runs as a **non-root user** with a built-in health check
(`docker ps` shows `healthy`), as the image's own user (1000:1000) unless you
set `user:`. The Unraid recipes use `99:100` (Unraid's nobody:users); the
folders you mount must belong to whichever user it runs as, so on a fresh
install create them and `chown -R` them once.

#### Upgrading to the non-root image

Older images ran as root, so your existing `/config` and `/uploads` folders are
owned by root and the new container can't write to them. It stops at start-up
with a message like:

```
  DisGourd can't write to its data folders (running as 99:100):
    Database folder: /config  (EACCES)
```

Fix it once on the host (Unraid terminal), using your own volume paths, then
start the container again:

```bash
chown -R 99:100 /mnt/user/appdata/disgourd /mnt/user/your-share/disgourd-uploads
```

(Use `1000:1000` instead if you don't set `user:`.)

**Always set `JWT_SECRET`** to 32+ random characters. Short or placeholder
values are ignored; the server then generates one and keeps it in a
`.jwt-secret` file next to the database (`/config` above), so mount that
volume or everyone gets logged out on rebuild. Raise `MAX_UPLOAD_BYTES` if you want to share
videos bigger than the 25 MB default.

### Behind a reverse proxy (HTTPS — required for voice)

Mic/camera (and the clipboard) only work over a **secure origin**, so put the
container behind a reverse proxy that terminates HTTPS. **The proxy must forward
WebSockets** — the realtime gateway (`/gateway`) is a WS connection; without the
upgrade headers the app loads but never reaches "Connected".

A ready-to-use **SWAG** config is at
[`deploy/swag/disgourd.subdomain.conf.sample`](deploy/swag/disgourd.subdomain.conf.sample):
copy it to `<swag-appdata>/nginx/proxy-confs/disgourd.subdomain.conf`, put the
DisGourd container on the same Docker network as SWAG, and browse to
`https://disgourd.<yourdomain>`. (Note: voice audio itself is peer-to-peer WebRTC and
does **not** flow through the proxy — HTTPS unlocks the mic; a tough NAT may still
need a TURN server, which you can set via `window.__DISGOURD_ICE__`.)

## Configuration

All settings are optional and provided via environment variables (or
`server/config.json` for `port`/`jwtSecret`):

| Variable           | Default                  | Description                                        |
| ------------------ | ------------------------ | -------------------------------------------------- |
| `PORT`             | `3000`                   | Port the server listens on                         |
| `JWT_SECRET`       | auto-generated           | Secret used to sign login tokens (32+ characters; placeholders are rejected) |
| `JWT_SECRET_FILE`  | `.jwt-secret` next to the database | Where the JWT secret is read from (or generated into) when `JWT_SECRET` isn't set. Can point at a Docker secret |
| `DB_PATH`          | `server/db/disgourd.db`  | SQLite database file location                      |
| `UPLOADS_DIR`      | `uploads/`               | Where uploaded files are stored                    |
| `MAX_UPLOAD_BYTES` | `26214400` (25 MB)       | Maximum upload size                                |
| `UPLOAD_QUOTA_BYTES_PER_DAY` | `524288000` (500 MB) | How much one person can upload in 24 hours (site admins are exempt). Deleting files doesn't give it back |
| `UPLOADS_MAX_TOTAL_BYTES` | _(off)_           | Refuse new uploads once the uploads folder reaches this size |
| `WEB_DIST`         | `web/dist`               | Location of the built web client                   |
| `REGISTRATION_MODE`| `open`                   | Initial mode: `open`, `code`, or `closed`. Seeds the setting on first run; after that, site admins change it in-app |
| `REGISTRATION_CODE`| _(none)_                 | An optional always-valid shared code (in addition to any codes minted in-app) |
| `MAX_ACCOUNTS`     | `0` (unlimited)          | Cap on the total number of accounts                |
| `SITE_ADMINS`      | _(none)_                 | Comma-separated usernames to make site admins (e.g. `alice,bob`). Each name is applied once: an account that exists then is promoted; a name nobody has yet is never promoted later (make them admin in Settings instead), and someone demoted in the app stays demoted |
| `SETUP_CODE`       | auto-generated           | The one-time code the setup wizard asks for on an empty server. Generated into `.setup-code` next to the database if not set |
| `TRUST_PROXY`      | _(off)_                  | Set to `1` behind a reverse proxy so rate limits use the client IP from `X-Forwarded-For` (last hop). Leave off when clients connect directly |
| `BACKUP_DIR`       | `backups/` next to the database | Where automatic database backups go. Set to `off` to disable them |
| `BACKUP_INTERVAL_HOURS` | `24`                | How often to take a backup                         |
| `BACKUP_KEEP`      | `7`                      | How many backups to keep (oldest are deleted)      |
| `THREAD_ARCHIVE_DAYS` | `7`                   | Threads with no new reply for this many days are archived (a new reply reopens them) |
| `VAPID_CONTACT`    | `mailto:admin@disgourd.local` | Contact address sent to push services with web push notifications |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | from `.vapid.json` | The push signing keys. Set both or neither (one alone stops the start). Without them, a pair is generated on first run and kept in `.vapid.json` next to the database. `VAPID_PRIVATE_KEY_FILE` reads the private key from a file |
| `KIEAI_API_KEY`    | _(none)_                 | The kie.ai API key. Wins over a key saved in Settings (which is stored in the database, so it's in every backup). `KIEAI_API_KEY_FILE` reads it from a file |
| `PUSH_HOSTS_EXTRA` | _(none)_                 | Extra push services to allow, comma-separated (`push.example.org` exact, or `*.example.org` for subdomains). The browsers' own services are always allowed |
| `ALLOWED_ORIGINS`  | _(none)_                 | Other sites allowed to call the API from a browser (CORS), comma-separated, e.g. `https://app.example.org`. The built-in app is same-origin and needs none |

Example (Linux/macOS):

```bash
PORT=8080 JWT_SECRET="$(openssl rand -hex 48)" npm start
```

## Keeping randoms out

Because DisGourd is meant for a known group of friends, lock down who can make
an account. Two layers, use both:

**1. Gate registration (app level).** The **first account created becomes the
site admin**. Site admins get a **Registration & access** panel in **Settings**
where they can, with no config editing:

- switch the mode between **open** / **code required** / **closed**,
- **mint invite codes** (with optional use limits and expiry), **copy** them to
  share, and **revoke** them, and
- **promote/demote other site admins**.

New users then enter a code on the sign-up screen. You can also pre-seed things
from the environment — an initial mode, an always-valid shared code, an account
cap, and site admins by username:

```bash
REGISTRATION_MODE=code REGISTRATION_CODE="gourds-4-life" \
  MAX_ACCOUNTS=25 SITE_ADMINS="alice" npm start
```

Registration attempts are rate-limited per IP, and codes are compared in
constant time and never sent to the browser.

**2. Don't expose it to the whole internet (network level — the strongest).**
The surest way to keep strangers out is to make sure they can't reach the server
at all:

- **Tailscale (VPN):** install Tailscale on the host and your friends' devices;
  share the machine over your tailnet and hand out `http://<machine>:3000`. Only
  devices on your tailnet can connect — nobody else can even find it. (Tailscale
  also gives you HTTPS via `tailscale cert` / `tailscale serve`.)
- **Cloudflare Tunnel + Access:** run `cloudflared tunnel` to publish the app
  without opening a port or exposing your home IP, and put **Cloudflare Access**
  in front with an email allowlist or one-time-PIN, so only approved people's
  requests ever reach DisGourd.

Do the network step and only your people can connect; the registration code is a
second lock behind it.

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

**Automatic backups.** While it runs, the server saves a copy of the database
every 24 hours (and on startup if the last one is older than that) into a
`backups/` folder next to the database — `server/db/backups/` by default, or
`/config/backups/` in Docker. Files are named `disgourd-YYYYMMDD-HHMMSS.db`
(UTC) and the newest 7 are kept. The copies are made with SQLite's
`VACUUM INTO`, so they're consistent even while people are chatting. Change
this with `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS` and `BACKUP_KEEP` (see
[Configuration](#configuration)).

Uploads aren't included — back up the `uploads/` folder (or your uploads
volume) with your normal file backups.

**Restoring a backup:**

1. Stop the server (or the container).
2. Delete `disgourd.db-wal` and `disgourd.db-shm` next to the database, if present.
3. Replace `disgourd.db` with the backup file, renamed to `disgourd.db`.
4. Start the server again.

To reset everything, stop the server and delete the database and uploads.

## Secrets and backups

A few values are secrets: anyone who has them can sign in as anyone, or spend
your money. Keep them in the host's secret store or an env file (mode `0600`,
not in git, not in the image), never in the app's settings.

| Secret | Read from | If it's lost |
| --- | --- | --- |
| JWT secret | `JWT_SECRET`, else `.jwt-secret` next to the database (or `JWT_SECRET_FILE`) | Everyone is signed out and signs in again |
| Push keys (VAPID) | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (or `VAPID_PRIVATE_KEY_FILE`), else `.vapid.json` next to the database | Every push subscription stops working; people turn notifications on again |
| kie.ai key | `KIEAI_API_KEY` (or `KIEAI_API_KEY_FILE`), else the one saved in Settings | Generation with kie.ai stops until a key is added |
| SMTP password (planned) | the environment only | Email stops |
| Backup storage keys (R2, for Litestream) | Litestream's own environment, not DisGourd's | Replication stops |
| TURN credentials (if you run a relay) | the TURN server's own config; browsers get them via `window.__DISGOURD_ICE__` | Calls between strict networks fail to connect |

Every `*_FILE` variable names a file to read the value from, once at start,
which is how Docker or compose secrets (`/run/secrets/...`) are passed without
the value showing in `docker inspect`.

**Moving generated secrets into the environment.** If DisGourd generated its
JWT secret and push keys into files, print them as env lines (it only reads):

```bash
node server/scripts/print-secrets-env.js /config
```

In Docker: `docker exec disgourd node server/scripts/print-secrets-env.js /config`.
Put the output in your secret store, restart, and then the files can go.

**What the backups contain.** The nightly copies (and a Litestream replica) are
the whole database: accounts and password hashes, every message and DM, and a
kie.ai key if one was saved in Settings. The server warns at start if a kie.ai
key is both in the environment and saved; remove the saved one in
Settings › Image generation › kie.ai. The backups don't contain
`.jwt-secret` or `.vapid.json`, so a restore from the backups alone signs
everyone out and loses push subscriptions, unless those secrets are kept too.

**Litestream to R2 (or any S3 storage).** Use a private bucket and an API token
scoped to that one bucket. Give the token to Litestream, not DisGourd. The
current release (0.5.x) has no client-side encryption (the `age` option was
removed after 0.3.x), so the bucket holds the database as it is: treat access
to it like access to the server.

**Backing up the secrets themselves.** In a password manager or the host's
secret store, not in the same bucket as the database.

**A restore drill.** Now and then, restore the latest backup into a scratch copy
(a separate `DB_PATH` and port, with the secrets from your store in the
environment), start it, and sign in. If you can sign in without being signed
out, the backup and the secrets match.

## Security notes

- Passwords are hashed with **scrypt** and never stored in plain text.
- Login tokens are signed JWTs that expire after 7 days.
- Auth endpoints are rate-limited against brute-force attempts.
- Uploaded files get randomized storage paths and are served with
  `X-Content-Type-Options: nosniff` and a sandboxing CSP, cached only by the
  viewer's browser (a day); executable types are rejected.
- A file is deleted from disk when the last message (or avatar, server icon,
  emoji) using it goes, within about 30 seconds; a daily sweep removes uploads
  nothing ever used. Each person has a daily upload quota (see
  `UPLOAD_QUOTA_BYTES_PER_DAY`).
- The server only fetches things on its own for link previews, preview images
  and generated images, and those refuse private, loopback, link-local and
  Tailscale addresses. Push notifications go only to the browsers' push
  services (Google, Mozilla, Microsoft, Apple), checked again before each send,
  at most 10 devices per person. So nobody can point the server at your router
  or NAS.
- **ComfyUI** is the one exception: it's meant to live on your LAN (or a
  tailnet), so private addresses are allowed there, but link-local and cloud
  metadata addresses are refused. Keep ComfyUI itself off the internet: never
  port-forward or publicly tunnel it (anyone who reaches it can run workflows).
- Site admins can **suspend** an account in Settings › People: it's signed out
  everywhere and can't sign in until the suspension is lifted. Its messages
  stay.
- By default, only friends and people who share a server can start a DM with
  someone or add them to a group. Each person can allow everyone instead
  (Settings › Privacy & safety). Friend requests are limited to 20 a day each.
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

## Roles & permissions

Every member has a role — **owner > admin > member** — and permissions are just
a **minimum role** for each thing, which keeps them simple.

- **Server permissions** (owner only): server menu → **🛡 Permissions**. Set the
  minimum role for each action — create/delete channels, invite, remove members,
  delete others' messages, edit the server, manage roles. The owner can always
  do everything.
- **Channel access** (owner/admin): hover a channel → the **⚙** gear. Choose
  **who can see** it and **who can post** — e.g. a read-only *announcements*
  channel (everyone views, admins post), a private *staff* channel (admins only),
  or owner-only. Restricted channels show a 🔒.

Everything is **enforced on the server**, not just hidden in the UI: channels you
can't view are filtered out of what your client receives, and posting where you
lack permission is rejected. Changes apply to everyone live.

## Voice chat

Owners/admins can create **voice channels** (🔊). Click one to join, and talk
with everyone else in it. Voice uses **peer-to-peer WebRTC in a mesh** — audio
flows directly between browsers and never touches the server (it only relays the
connection handshake), so there's still nothing extra to run. This is ideal for
small friend-group calls (roughly up to 5–6 people at once).

While connected you can **mute** yourself (🎤), **deafen** (🎧 — silences
everyone and mutes you), or use **push-to-talk** so your mic only transmits
while you hold a key. Configure these under **Settings → Voice & audio**, along
with a **speaker test** tone and **join/leave chimes**. Keyboard shortcuts
(mute `Ctrl+Shift+M`, deafen `Ctrl+Shift+D`, and your push-to-talk key) work
while the DisGourd window is focused.

**Sharing app audio** (🎵 *Share app audio*): broadcast sound from another
program — music, a video — to everyone in the channel. It appears as its **own
participant** ("🎵 *name*'s audio") separate from your microphone, so people keep
hearing you talk while it plays, and **each listener can mute it or set its
volume just for themselves** without affecting your voice. Pick a browser **Tab**
and check "Share tab audio" (works on any OS), or your whole **Screen** with
"Share system audio" (Windows/ChromeOS) to share a desktop app like Spotify.
Capturing audio this way needs **Chrome or Edge**, but everyone *listening*
hears it on any browser — so one person can DJ for a mixed-browser room. The
button only appears where the browser can capture display audio.

**Video & screen sharing**: while in a voice channel, turn on your **camera**
(📹) or **share your screen** (🖥️). Live video appears in a grid above the chat,
so you can keep reading and typing while you watch. Both are separate tracks, so
you can do either or both, and other people's video shows up automatically. (For
a friend-group mesh, video is best with a handful of people at once.)

Connections **recover automatically** from brief network drops (an ICE restart
re-establishes the link rather than going silent), and changing your microphone
or speaker in Settings **applies immediately** to a call in progress.

- Requires **HTTPS** in production — browsers only grant microphone access on
  secure origins (localhost is exempt for testing).
- A public STUN server is used by default for NAT traversal, which works on most
  home networks. For stricter networks you can add a TURN relay by setting
  `window.__DISGOURD_ICE__` to an array of `RTCIceServer` objects before the app
  loads (e.g. via a small inline script), pointing at your own coturn server.

## Roadmap

Working today: accounts with avatars, servers with ownership and invite codes,
text channels, real-time messaging with edit/delete, emoji reactions, typing
indicators, unread badges, @mentions, direct messages, message search, file
sharing, presence, a per-server member list, roles (owner/admin/member with
promote, demote, and remove), spoiler tags (`||text||` and per-image), and
peer-to-peer voice channels with app-audio sharing, camera video, and screen
sharing.
