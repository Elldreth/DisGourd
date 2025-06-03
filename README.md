# DisGourd

A simple chat application. The `server` folder contains a WebSocket server written without external dependencies.

See `server/README.md` for details.

User registration (which now requires an email address) and login endpoints provide JWT tokens. Pass the token as a `token` query parameter when opening a WebSocket connection.

HTTP endpoints are available for listing past messages and administration. See the server README for usage details.
