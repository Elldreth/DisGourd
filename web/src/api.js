// Thin REST client for the DisGourd backend. All calls use same-origin relative
// paths, which the Vite dev server proxies to the backend (see vite.config.js)
// and which resolve directly when the built app is served by the backend.

const TOKEN_KEY = 'disgourd.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Decode the username/id we baked into the JWT payload (best-effort, no verify).
export function decodeToken(token = getToken()) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}

// Called when an authenticated request comes back 401 — i.e. the stored token
// is invalid/expired (or the server was reset). The app uses this to log out
// cleanly instead of getting stuck in an "Unauthorized / Reconnecting…" state.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (res.status === 401 && auth && getToken()) {
    // Our token is no longer accepted — drop it and let the app return to login.
    clearToken();
    if (onUnauthorized) onUnauthorized();
  }
  if (!res.ok) {
    const message = (data && data.error) || res.statusText || 'Request failed';
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- Auth ----
export function register(username, password, email, code) {
  return request('/register', { method: 'POST', auth: false, body: { username, password, email, code } });
}
export function login(username, password) {
  return request('/login', { method: 'POST', auth: false, body: { username, password } });
}
// How registration is gated on this server: 'open' | 'code' | 'closed'.
export function getAuthInfo() {
  return request('/auth-info', { method: 'GET', auth: false });
}

// ---- Instance admin: registration management (site admins only) ----
export function getAdminRegistration() {
  return request('/admin/registration');
}
// Link previews for the whole instance (site admins only).
export function setLinkPreviews(enabled) {
  return request('/admin/link-previews', { method: 'PUT', body: { enabled } });
}
export function setRegistrationMode(mode) {
  return request('/admin/registration', { method: 'PUT', body: { mode } });
}
export function createRegCode(opts) {
  return request('/admin/registration/codes', { method: 'POST', body: opts || {} });
}
export function revokeRegCode(id) {
  return request(`/admin/registration/codes/${id}`, { method: 'DELETE' });
}
export function setSiteAdmin(username, admin) {
  return request(`/admin/registration/admins/${encodeURIComponent(username)}`, { method: 'PUT', body: { admin } });
}

// ---- Servers (spaces) / channels ----
// Only servers the current user belongs to are returned.
export function getSpaces() {
  return request('/spaces');
}
// template: 'blank' | 'friends' | 'gaming' | 'study' (the server falls back to blank).
export function createSpace(name, template) {
  return request('/spaces', { method: 'POST', body: { name, template } });
}
export function deleteSpace(space) {
  return request(`/spaces/${encodeURIComponent(space)}`, { method: 'DELETE' });
}
export function renameSpace(space, name) {
  return request(`/spaces/${encodeURIComponent(space)}`, { method: 'PATCH', body: { name } });
}
export function setSpaceIcon(space, icon, iconOriginal = null, iconCrop = null) {
  return request(`/spaces/${encodeURIComponent(space)}`, {
    method: 'PATCH',
    body: { icon, iconOriginal, iconCrop },
  });
}
export function setServerPermissions(space, permissions) {
  return request(`/spaces/${encodeURIComponent(space)}/permissions`, { method: 'PUT', body: { permissions } });
}
export function setChannelPermissions(space, channel, view, post) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/permissions`, {
    method: 'PATCH',
    body: { view, post },
  });
}
export function createChannel(space, name, type) {
  return request(`/spaces/${encodeURIComponent(space)}/channels`, {
    method: 'POST',
    body: type ? { name, type } : { name },
  });
}
export function deleteChannel(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, {
    method: 'DELETE',
  });
}

// ---- Members & invites ----
export function getMembers(space) {
  return request(`/spaces/${encodeURIComponent(space)}/members`);
}
export function createInvite(space) {
  return request(`/spaces/${encodeURIComponent(space)}/invites`, { method: 'POST' });
}
export function setMemberRole(space, username, role) {
  return request(`/spaces/${encodeURIComponent(space)}/members/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: { role },
  });
}
export function kickMember(space, username) {
  return request(`/spaces/${encodeURIComponent(space)}/members/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
}
export function previewInvite(code) {
  return request(`/invites/${encodeURIComponent(code)}`);
}
export function joinInvite(code) {
  return request(`/invites/${encodeURIComponent(code)}`, { method: 'POST' });
}

// ---- Messages ----
// Latest page by default; `before` (a message id) gets the page just older.
// One of: the newest page, a page `before` an id, the page `after` an id, or a
// window `around` one message (25 either side; rejects if it isn't there).
export function getMessages(space, channel, { limit = 50, offset = 0, before, after, around } = {}) {
  const qs = new URLSearchParams(
    around ? { around } : after ? { limit, after } : before ? { limit, before } : { limit, offset }
  );
  return request(
    `/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/messages?${qs}`
  );
}

// A channel's pinned messages, most recently pinned first.
export function getPins(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/pins`);
}

// ---- Web Push (P2-18b) ----
export function getVapidKey() {
  return request('/push/vapid-key');
}
export function savePushSubscription(subscription, previews) {
  return request('/push/subscriptions', { method: 'POST', body: { subscription, previews } });
}
export function deletePushSubscription(endpoint) {
  return request('/push/subscriptions', { method: 'DELETE', body: { endpoint } });
}

// ---- Custom server emoji (P2-19) ----
export function getEmoji(space) {
  return request(`/spaces/${encodeURIComponent(space)}/emoji`);
}
// `url` is an upload made with uploadFile first.
export function addEmoji(space, name, url) {
  return request(`/spaces/${encodeURIComponent(space)}/emoji`, { method: 'POST', body: { name, url } });
}
export function deleteEmoji(space, name) {
  return request(`/spaces/${encodeURIComponent(space)}/emoji/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ---- Threads ----
// Start a thread from a message in `channel` (or get the one it already has).
// Resolves to { thread }; `name` is optional (the server takes it from the message).
export function createThread(space, channel, messageId, name) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/threads`, {
    method: 'POST',
    body: { messageId, name },
  });
}
// Follow or unfollow a thread by hand (you auto-follow ones you start, post
// in or are mentioned in).
export function followThread(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/follow`, { method: 'PUT' });
}
export function unfollowThread(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/follow`, { method: 'DELETE' });
}
// Archive or reopen a thread by hand (people who may pin messages).
export function archiveThread(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/archive`, { method: 'PUT' });
}
export function reopenThread(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/archive`, { method: 'DELETE' });
}
// A channel's threads, most recently active first (archived ones if asked).
export function getThreads(space, channel, archived = false) {
  return request(
    `/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/threads${archived ? '?archived=1' : ''}`
  );
}

// ---- Search ----
export function search(q) {
  return request(`/search?q=${encodeURIComponent(q)}`);
}

// ---- Direct messages ----
export function getDms() {
  return request('/dms');
}
export function getDmMessages(username, { limit = 50, before, after, around } = {}) {
  const qs = new URLSearchParams(around ? { around } : after ? { limit, after } : before ? { limit, before } : { limit });
  return request(`/dms/${encodeURIComponent(username)}/messages?${qs}`);
}

// ---- Current user profile ----
export function getMe() {
  return request('/me');
}
export function updateMe(patch) {
  return request('/me', { method: 'PATCH', body: patch });
}

// ---- Friends ----
export function getFriends() {
  return request('/friends');
}

// ---- Uploads ----
// Streams the raw file body; the server derives a collision-free URL and
// returns { url, name, size, type, inline }. onProgress(0..1) is optional.
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/uploads?name=${encodeURIComponent(file.name)}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const data = safeJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}
