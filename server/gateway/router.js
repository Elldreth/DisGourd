// Gateway frame router. Parses and validates each incoming frame, then calls
// the handler registered for its `op`. Unknown ops are ignored.
//
// To add an op: write the handler in the matching domain file (chat.js, dm.js
// or voice.js) and add one entry to OPS below.
const WebSocket = require('ws');
const { isPlainObject } = require('../http/util');
const limits = require('./limits');
const chat = require('./chat');
const dm = require('./dm');
const voice = require('./voice');
const imagine = require('../imagine');

// Fields that are always strings when present; a frame carrying an object or
// number in one of them is malformed and dropped whole.
const GATEWAY_STRING_FIELDS = ['op', 'space', 'channel', 'with', 'content', 'emoji', 'prompt', 'shape', 'quality', 'engine'];

// A Map, not a plain object, so an op like 'constructor' can't resolve to an
// inherited property.
const OPS = new Map([
  // chat
  ['focus', chat.ops.focus],
  ['read', chat.ops.read],
  ['message', chat.ops.message],
  ['edit', chat.ops.edit],
  ['delete', chat.ops.delete],
  ['react', chat.ops.react],
  ['pin', chat.ops.pin],
  ['unpin', chat.ops.unpin],
  ['typing', chat.ops.typing],
  // dm
  ['dm', dm.ops.dm],
  ['dm_edit', dm.ops.dm_edit],
  ['dm_delete', dm.ops.dm_delete],
  ['dm_focus', dm.ops.dm_focus],
  ['dm_read', dm.ops.dm_read],
  ['dm_typing', dm.ops.dm_typing],
  // P9-06c: group DMs
  ['dm_group_create', dm.ops.dm_group_create],
  ['dm_group_add', dm.ops.dm_group_add],
  ['dm_group_remove', dm.ops.dm_group_remove],
  ['dm_group_leave', dm.ops.dm_group_leave],
  ['dm_group_rename', dm.ops.dm_group_rename],
  ['dm_mute', dm.ops.dm_mute],
  // voice
  ['voice_join', voice.ops.voice_join],
  ['voice_leave', voice.ops.voice_leave],
  ['voice_signal', voice.ops.voice_signal],
  ['voice_mute', voice.ops.voice_mute],
  ['voice_share', voice.ops.voice_share],
  // image generation (P2-20)
  ['imagine', imagine.imagineOp],
]);

function handleGatewayMessage(ws, raw) {
  // P11-03: a socket flooding far past the limits is closed.
  if (limits.flooded(ws)) {
    if (!ws.floodClosing) {
      ws.floodClosing = true;
      ws.close(1008, 'Too many messages');
      // Don't wait out the close handshake with a flooding peer.
      setTimeout(() => ws.terminate(), 1000).unref();
    }
    return;
  }
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!isPlainObject(msg)) return;
  for (const key of GATEWAY_STRING_FIELDS) {
    if (msg[key] !== undefined && typeof msg[key] !== 'string') return;
  }
  const userId = ws.userId;
  const handler = OPS.get(msg.op);
  if (!handler) return;
  // P11-03: per-person rate limits; a refused frame is dropped.
  const verdict = limits.allow(userId, msg.op);
  if (!verdict.ok) {
    if (!verdict.silent && ws.readyState === WebSocket.OPEN && limits.shouldTell(ws, msg.op)) {
      ws.send(JSON.stringify({
        type: 'error', op: msg.op, code: 'RATE_LIMITED', retryAfter: Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)),
        ...(typeof msg.space === 'string' && msg.space.length <= 100 ? { space: msg.space } : {}),
        ...(typeof msg.channel === 'string' && msg.channel.length <= 100 ? { channel: msg.channel } : {}),
        error: "You're sending messages too fast",
      }));
    }
    return;
  }
  handler({ ws, msg, userId });
}

module.exports = { handleGatewayMessage };
