# DisGourd Client

This is a minimal WebSocket client written in Node.js for interacting with the chat server in the `server` directory.

## Usage

```
node client.js [space] [channel]
```

- **space** – name of the space to connect to (default: `default`)
- **channel** – channel within the space (default: `general`)

Run the server first (`node server/server.js`) and then start the client. Type messages and they will be broadcast to other clients connected to the same channel. Type `/quit` to exit.
