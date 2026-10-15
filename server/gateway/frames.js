const WebSocket = require('ws');
const { MAX_MESSAGE_LENGTH } = require('../validate');

// Tell the sender why a frame was refused (clients may ignore this).
function rejectFrame(ws, op, error) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', op, error }));
}
const TOO_LONG = `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`;

module.exports = { rejectFrame, TOO_LONG };
