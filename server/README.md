# DisGourd Server

This is a minimal WebSocket chat server implemented with only Node.js built-in modules and an SQLite database. It allows creation of custom spaces and channels similar to Discord.

## Configuration

Edit `config.json` to change the listening port and JWT secret. Environment
variables can override these values and the database location. Create a `.env`
file or set variables at runtime.

```
{
  "port": 3000,
  "jwtSecret": "changeme"
}
```

Alternatively configure a `.env` file:

```
PORT=3000
JWT_SECRET=changeme
DB_PATH=./db/disgourd.db
```

## API

### Create Space

```
POST /space
{"name": "mySpace"}
```

### Create Channel

```
POST /space/{space}/channel
{"name": "general"}
```

### WebSocket Connection

Connect to `/ws/{space}/{channel}`. Messages sent will be broadcast to other clients in the same channel.
Add `?history=N` to the connection URL to receive the last `N` messages upon connecting.

### Get Messages

```
GET /spaces/{space}/channels/{channel}/messages?limit=20&offset=0
```

Returns an array of recent messages, each containing `content`, `timestamp` and `author`.

## Authentication

Users must register and obtain a JWT before connecting via WebSocket.

### Register

```
POST /register
{"username": "alice", "password": "secret"}
```

Returns a token which should be supplied when connecting.

### Login

```
POST /login
{"username": "alice", "password": "secret"}
```

On success a JWT token is returned.

Include the token as a `token` query parameter when establishing the WebSocket connection, e.g.

```
ws://host:port/ws/mySpace/general?token=YOUR_JWT
```

## Running

```
npm install
node server.js
```

Data is stored in `db/disgourd.db` using SQLite, so spaces, channels and messages persist between restarts.

