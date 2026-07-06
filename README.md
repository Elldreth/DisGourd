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

Each person can pick their own **microphone and speaker** for voice under
**Settings** (click your name in the bottom-left) → **Voice & audio**, including
a mic test — independent of the operating-system default.

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
| `REGISTRATION_MODE`| `open`                   | Initial mode: `open`, `code`, or `closed`. Seeds the setting on first run; after that, site admins change it in-app |
| `REGISTRATION_CODE`| _(none)_                 | An optional always-valid shared code (in addition to any codes minted in-app) |
| `MAX_ACCOUNTS`     | `0` (unlimited)          | Cap on the total number of accounts                |
| `SITE_ADMINS`      | _(none)_                 | Comma-separated usernames to make site admins (e.g. `alice,bob`)   |

Example (Linux/macOS):

```bash
PORT=8080 JWT_SECRET="a-long-random-string" npm start
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
REGISTRATION_MODE=code REGISTRATION_CODE="pickles-4-life" \
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
