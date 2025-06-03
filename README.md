# DisGourd

A simple chat application. The `server` folder contains a WebSocket server written without external dependencies.

See `server/README.md` for details.

User registration and login endpoints provide JWT tokens. Pass the token as a `token` query parameter when opening a WebSocket connection.
