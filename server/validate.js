const { passwordProblem } = require('./auth/commonPasswords');

const MAX_MESSAGE_LENGTH = 4000;

function validateSpaceName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'A server name is required';
  if (name.trim().length > 60) return 'Server name must be 60 characters or fewer';
  return null;
}

function normalizeChannelName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
}

function validateChannelName(name) {
  const normalized = normalizeChannelName(name);
  if (!normalized) return 'A channel name is required';
  if (normalized.length > 60) return 'Channel name must be 60 characters or fewer';
  return null;
}

// Extract @username tokens from message content (deduplicated).
function parseMentionUsernames(content) {
  // Keyed by lower case: `@Sandy @sandy` is one name (P11-12); the first spelling is kept.
  const names = new Map();
  const re = /@([A-Za-z0-9_.-]{3,32})/g;
  let m;
  while ((m = re.exec(content)) !== null) if (!names.has(m[1].toLowerCase())) names.set(m[1].toLowerCase(), m[1]);
  return [...names.values()];
}

// Album support: accept a list of attachment URLs (msg.attachments) or a single
// msg.attachment, keeping only our own uploaded paths and capping the count.
const MAX_ATTACHMENTS = 10;
function normalizeAttachments(msg) {
  let list = [];
  if (Array.isArray(msg.attachments)) list = msg.attachments;
  else if (typeof msg.attachment === 'string') list = [msg.attachment];
  return list
    .filter((u) => typeof u === 'string' && u.startsWith('/uploads/'))
    .slice(0, MAX_ATTACHMENTS);
}

function validateRegistration({ username, password, email }, { requireEmail = false } = {}) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return 'Username must be 3-32 characters using letters, numbers, or _ . -';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be between 8 and 200 characters';
  }
  const easy = passwordProblem(password, username); // P11-08
  if (easy) return easy;
  // P12-02: optional (owner decision 4), unless the server requires a confirmed one.
  if (email == null || email === '') return requireEmail ? 'An email address is required on this server' : null;
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Enter a valid email address, or leave it empty';
  }
  return null;
}

// A reaction must be exactly one emoji: a single grapheme (so ZWJ families,
// skin tones, flags and keycaps all count as one) that contains a pictographic
// character, regional indicator or keycap mark. Anything else (text, several
// emoji) is refused rather than trimmed. The longest real emoji are ~15 UTF-16
// units; 32 leaves room for new ones. Returns the emoji, or null.
const MAX_REACTION_LENGTH = 32;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const EMOJI_MARK = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
// A custom server emoji as a reaction: <:name:id> (P2-19b). Whether that
// emoji exists in the message's server is checked by the react op.
const CUSTOM_REACTION_RE = /^<:([a-z0-9_]{2,32}):(\d{1,12})>$/;
function parseCustomReaction(value) {
  const m = typeof value === 'string' ? CUSTOM_REACTION_RE.exec(value.trim()) : null;
  return m ? { token: m[0], name: m[1], id: parseInt(m[2], 10) } : null;
}

function parseReactionEmoji(value) {
  if (typeof value !== 'string') return null;
  const emoji = value.trim();
  if (CUSTOM_REACTION_RE.test(emoji)) return emoji;
  if (!emoji || emoji.length > MAX_REACTION_LENGTH) return null;
  let count = 0;
  for (const _ of graphemes.segment(emoji)) if (++count > 1) return null;
  return EMOJI_MARK.test(emoji) ? emoji : null;
}

module.exports = {
  MAX_MESSAGE_LENGTH, MAX_ATTACHMENTS, validateSpaceName, normalizeChannelName, validateChannelName,
  parseMentionUsernames, normalizeAttachments, validateRegistration, parseReactionEmoji, parseCustomReaction,
};
