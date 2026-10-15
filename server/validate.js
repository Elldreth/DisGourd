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
  const names = new Set();
  const re = /@([A-Za-z0-9_.-]{3,32})/g;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1]);
  return [...names];
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

function validateRegistration({ username, password, email }) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return 'Username must be 3-32 characters using letters, numbers, or _ . -';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be between 8 and 200 characters';
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'A valid email address is required';
  }
  return null;
}

module.exports = {
  MAX_MESSAGE_LENGTH, MAX_ATTACHMENTS, validateSpaceName, normalizeChannelName, validateChannelName,
  parseMentionUsernames, normalizeAttachments, validateRegistration,
};
