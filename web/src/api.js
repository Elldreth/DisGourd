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

// ---- Instance admin: /imagine (P2-20b) ----
export function getImagineSettings() {
  return request('/admin/imagine');
}
export function saveImagineSettings(settings) {
  return request('/admin/imagine', { method: 'PUT', body: settings });
}
// The checkpoints a ComfyUI server offers: { url, models: [{ name, family }] }.
export function testComfyUI(url) {
  return request('/admin/imagine/comfyui/test', { method: 'POST', body: { url } });
}
// Check a kie.ai key (the given one, or the saved one when blank): { credits }.
export function testKie(apiKey) {
  return request('/admin/imagine/kie/test', { method: 'POST', body: { apiKey } });
}
// One test image from an engine's saved settings: { url, width, height, ms }.
export function tryImagine(body) {
  return request('/admin/imagine/try', { method: 'POST', body });
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
// ---- /imagine per server and channel (P2-20d) ----
export function setServerImagine(space, { enabled, dailyLimit }) {
  return request(`/spaces/${encodeURIComponent(space)}/imagine`, { method: 'PATCH', body: { enabled, dailyLimit } });
}
// Remove a message's link cards (P3-20c): the author, or a moderator in a channel.
export function hideChannelPreview(space, channel, id) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/messages/${id}/preview`, { method: 'DELETE' });
}
export function hideDmPreview(username, id) {
  return request(`/dms/${encodeURIComponent(username)}/messages/${id}/preview`, { method: 'DELETE' });
}
// A channel's topic (P3-20a); '' clears it.
export function setChannelTopic(space, channel, topic) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, { method: 'PATCH', body: { topic } });
}
export function setChannelNsfw(space, channel, nsfw) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, { method: 'PATCH', body: { nsfw } });
}

// ---- Roles (P2-21c) ----
const rolesPath = (space) => `/spaces/${encodeURIComponent(space)}/roles`;
export function getRoles(space) {
  return request(rolesPath(space));
}
export function createRole(space, fields) {
  return request(rolesPath(space), { method: 'POST', body: fields });
}
export function updateRole(space, id, fields) {
  return request(`${rolesPath(space)}/${id}`, { method: 'PATCH', body: fields });
}
export function deleteRole(space, id) {
  return request(`${rolesPath(space)}/${id}`, { method: 'DELETE' });
}
// `ids`: the roles you manage, bottom to top.
export function reorderRoles(space, ids) {
  return request(`${rolesPath(space)}/order`, { method: 'PUT', body: { ids } });
}
export function setMemberHasRole(space, username, roleId, on) {
  return request(`/spaces/${encodeURIComponent(space)}/members/${encodeURIComponent(username)}/roles/${roleId}`, {
    method: on ? 'PUT' : 'DELETE',
  });
}
// A channel's per-role overrides: [{ roleId, view, post }] (1 allow, 0 deny, null default).
export function getChannelOverrides(space, channel) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/overrides`);
}
export function setChannelOverrides(space, channel, overrides) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/overrides`, {
    method: 'PUT',
    body: { overrides },
  });
}
// `category` (P3-25b): an id, or null for the top; left out, the default for the type.
export function createChannel(space, name, type, category) {
  return request(`/spaces/${encodeURIComponent(space)}/channels`, {
    method: 'POST',
    body: { name, ...(type ? { type } : {}), ...(category !== undefined ? { category } : {}) },
  });
}
// ---- Channel categories (P3-25) ----
export function createCategory(space, name) {
  return request(`/spaces/${encodeURIComponent(space)}/categories`, { method: 'POST', body: { name } });
}
export function renameCategory(space, id, name) {
  return request(`/spaces/${encodeURIComponent(space)}/categories/${id}`, { method: 'PATCH', body: { name } });
}
export function deleteCategory(space, id) {
  return request(`/spaces/${encodeURIComponent(space)}/categories/${id}`, { method: 'DELETE' });
}
// Category permissions (P3-25d): per-role access copied onto channels created
// in or moved into the category; `apply` copies it onto every channel in it.
export function getCategoryOverrides(space, id) {
  return request(`/spaces/${encodeURIComponent(space)}/categories/${id}/overrides`);
}
export function setCategoryOverrides(space, id, overrides) {
  return request(`/spaces/${encodeURIComponent(space)}/categories/${id}/overrides`, { method: 'PUT', body: { overrides } });
}
export function applyCategoryOverrides(space, id) {
  return request(`/spaces/${encodeURIComponent(space)}/categories/${id}/apply`, { method: 'POST' });
}
// The whole order: { categories: [id…], channels: [{ name, category }…] }.
export function setLayout(space, layout) {
  return request(`/spaces/${encodeURIComponent(space)}/layout`, { method: 'PUT', body: layout });
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
// P3-26a: a page of the moderation log (newest first).
export function getModLog(space, { before, action, user } = {}) {
  const qs = new URLSearchParams();
  if (before) qs.set('before', before);
  if (action) qs.set('action', action);
  if (user) qs.set('user', user);
  return request(`/spaces/${encodeURIComponent(space)}/mod-log${qs.size ? `?${qs}` : ''}`);
}
// P3-26c: timeouts (minutes: 5, 60, 1440 or 10080).
export function timeoutMember(space, username, { minutes, reason } = {}) {
  return request(`/spaces/${encodeURIComponent(space)}/members/${encodeURIComponent(username)}/timeout`, { method: 'PUT', body: { minutes, reason } });
}
export function removeTimeout(space, username) {
  return request(`/spaces/${encodeURIComponent(space)}/members/${encodeURIComponent(username)}/timeout`, { method: 'DELETE' });
}
// P3-26b: bans.
export function banMember(space, username, { reason, deleteMessages } = {}) {
  return request(`/spaces/${encodeURIComponent(space)}/bans`, { method: 'POST', body: { user: username, reason, deleteMessages } });
}
export function getBans(space) {
  return request(`/spaces/${encodeURIComponent(space)}/bans`);
}
export function unbanMember(space, username) {
  return request(`/spaces/${encodeURIComponent(space)}/bans/${encodeURIComponent(username)}`, { method: 'DELETE' });
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
