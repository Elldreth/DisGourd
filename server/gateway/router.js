// Gateway frame router. Parses and validates each incoming frame, then calls
// the handler registered for its `op`. Unknown ops are ignored.
//
// To add an op: write the handler in the matching domain file (chat.js, dm.js
// or voice.js) and add one entry to OPS below.
const { isPlainObject } = require('../http/util');
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
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!isPlainObject(msg)) return;
  for (const key of GATEWAY_STRING_FIELDS) {
    if (msg[key] !== undefined && typeof msg[key] !== 'string') return;
  }
  const userId = ws.userId;
  const handler = OPS.get(msg.op);
  if (handler) handler({ ws, msg, userId });
}

module.exports = { handleGatewayMessage };
