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

// Change your password (P6-02). The server signs out every other device and
// returns a fresh token for this one, stored here before anything else runs.
// While it's in flight, a "signed_out" frame on this device's (old) socket
// waits for it (see stillSignedIn) instead of signing this device out too.
let passwordChange = null;
export function changePassword(currentPassword, newPassword) {
  const pending = request('/me/password', { method: 'POST', body: { currentPassword, newPassword } }).then((res) => {
    if (res?.token) setToken(res.token);
    return res;
  });
  passwordChange = pending;
  pending.catch(() => {}).finally(() => {
    if (passwordChange === pending) passwordChange = null;
  });
  return pending;
}

// Signed-in devices (P9-03).
export function getSessions() {
  return request('/me/sessions');
}
export function signOutSession(id) {
  return request(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
// Like a password change: this device's own socket gets "signed_out" too, so
// the fresh token is stored first and stillSignedIn waits for it.
export function signOutOtherSessions() {
  const pending = request('/me/sessions/sign-out-others', { method: 'POST' }).then((res) => {
    if (res?.token) setToken(res.token);
    return res;
  });
  passwordChange = pending;
  pending.catch(() => {}).finally(() => {
    if (passwordChange === pending) passwordChange = null;
  });
  return pending;
}
// End this device's session on the server (the token is read now, before
// the app forgets it).
export function logout() {
  return request('/logout', { method: 'POST' });
}

// After a "signed_out" frame: is the stored token still accepted? A 401 here
// clears it and runs the unauthorized handler (back to the sign-in screen).
export async function stillSignedIn() {
  if (passwordChange) await passwordChange.catch(() => {});
  try {
    await request('/me');
    return true;
  } catch {
    return false;
  }
}

// Called when an authenticated request comes back 401 — i.e. the stored token
// is invalid/expired (or the server was reset). The app uses this to log out
// cleanly instead of getting stuck in an "Unauthorized / Reconnecting…" state.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

let onEmailUnconfirmed = null;
export function setEmailUnconfirmedHandler(fn) {
  onEmailUnconfirmed = fn;
}

async function request(path, { method = 'GET', body, auth = true, headers = {}, retried = false } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const sent = auth ? getToken() : '';
  if (sent) finalHeaders['Authorization'] = `Bearer ${sent}`;
  const res = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (res.status === 401 && auth && getToken()) {
    // This device's token was just swapped (a password change, or signing out
    // the other devices, P9-03): a request that went out with the old one is
    // refused, so wait for the new one and try once more instead of signing out.
    if (passwordChange) await passwordChange.catch(() => {});
    if (!retried && getToken() && getToken() !== sent) return request(path, { method, body, auth, headers, retried: true });
    // Our token is no longer accepted — drop it and let the app return to login.
    if (getToken() === sent) {
      clearToken();
      if (onUnauthorized) onUnauthorized();
    }
  }
  // P12-02: the server now requires a confirmed email that this account lacks.
  if (res.status === 403 && data && data.code === 'EMAIL_UNCONFIRMED' && onEmailUnconfirmed) onEmailUnconfirmed();
  if (!res.ok) {
    const message = (data && data.error) || res.statusText || 'Request failed';
    throw Object.assign(new Error(message), { status: res.status, code: data && data.code });
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
// setupCode (P11-01): the one-time code an empty server needs for its first account.
// invite (P14-02): the server invite this sign-up came from; it joins that server.
export function register(username, password, email, code, setupCode, invite) {
  return request('/register', { method: 'POST', auth: false, body: { username, password, email, code, ...(setupCode ? { setupCode } : {}), ...(invite ? { invite } : {}) } });
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
// P14-02: { closedAllowsInvites?, invitesCreateAccounts? } (and mode).
export function setRegistrationSettings(settings) {
  return request('/admin/registration', { method: 'PUT', body: settings });
}
export function createRegCode(opts) {
  return request('/admin/registration/codes', { method: 'POST', body: opts || {} });
}
export function revokeRegCode(id) {
  return request(`/admin/registration/codes/${id}`, { method: 'DELETE' });
}
// People (P11-09): find accounts; suspend or lift.
export function searchUsers(q) {
  return request(`/admin/users?q=${encodeURIComponent(q)}`);
}
export function setSuspended(username, suspended, reason) {
  return request(`/admin/users/${encodeURIComponent(username)}`, { method: 'PUT', body: { suspended, ...(reason ? { reason } : {}) } });
}
// ---- Your email address (P12-02) ----
export function changeEmail(email, password) {
  return request('/me/email', { method: 'POST', body: { email, password } });
}
export function removeEmail(password) {
  return request('/me/email', { method: 'DELETE', body: { password } });
}
export function resendEmailLink() {
  return request('/me/email/resend', { method: 'POST' });
}
// ---- Password reset (P12-03) ----
// Always the same answer, whether or not the account exists.
export function forgotPassword(login) {
  return request('/password/forgot', { method: 'POST', auth: false, body: { login } });
}
// From a reset link: { ok, token } (or { ok, suspended }).
export function resetPassword(token, newPassword) {
  return request('/password/reset', { method: 'POST', auth: false, body: { token, newPassword } });
}
// Site admins: a one-time link (24 hours) to hand to someone. { path, expiresInHours }
export function makeResetLink(username) {
  return request(`/admin/users/${encodeURIComponent(username)}/reset-link`, { method: 'POST' });
}
// From the link in the email; works signed in or out.
export function confirmEmail(token) {
  return request('/email/confirm', { method: 'POST', auth: false, body: { token } });
}
export function setRequireConfirmedEmail(requireConfirmed) {
  return request('/admin/email', { method: 'PUT', body: { requireConfirmed } });
}

// ---- Instance admin: email (P12-01) ----
export function getEmailStatus() {
  return request('/admin/email');
}
export function sendTestEmail(to) {
  return request('/admin/email/test', { method: 'POST', body: to ? { to } : {} });
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
// Leave a server you're a member of (not one you own) — P6-01.
export function leaveSpace(space) {
  return request(`/spaces/${encodeURIComponent(space)}/members/me`, { method: 'DELETE' });
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
// P9-02: hand a server to another member (confirm = the server's name).
export function transferServer(space, user, confirm) {
  return request(`/spaces/${encodeURIComponent(space)}/transfer`, { method: 'POST', body: { user, confirm } });
}
// P9-01: message reports.
export function reportMessage(space, channel, id, { reason, note } = {}) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/messages/${id}/report`, { method: 'POST', body: { reason, note } });
}
export function getReports(space, { status = 'open', before } = {}) {
  const qs = new URLSearchParams({ status });
  if (before) qs.set('before', before);
  return request(`/spaces/${encodeURIComponent(space)}/reports?${qs}`);
}
export function resolveReport(space, id, { action, resolution } = {}) {
  return request(`/spaces/${encodeURIComponent(space)}/reports/${id}/resolve`, { method: 'POST', body: { action, resolution } });
}
// P3-27: a message's edit history.
export function getMessageVersions(space, channel, id) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/messages/${id}/versions`);
}
// P9-06b: a DM conversation's path from its key: `c:<id>`, or `@<username>`
// (a pair not started yet).
const dmPath = (key) => (key.startsWith('c:') ? `/dms/c/${key.slice(2)}` : `/dms/${encodeURIComponent(key.replace(/^@/, ''))}`);
export function getDmVersions(key, id) {
  return request(`${dmPath(key)}/messages/${id}/versions`);
}
export function hideDmPreview(key, id) {
  return request(`${dmPath(key)}/messages/${id}/preview`, { method: 'DELETE' });
}
// A channel's topic (P3-20a); '' clears it.
// P6-03: a new name, normalized and checked like a new channel's.
export function renameChannel(space, channel, name) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, { method: 'PATCH', body: { name } });
}
export function setChannelTopic(space, channel, topic) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, { method: 'PATCH', body: { topic } });
}
// P3-26d: seconds between posts (0, 5, 30, 60 or 300).
export function setChannelSlowmode(space, channel, slowmode) {
  return request(`/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}`, { method: 'PATCH', body: { slowmode } });
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
// P11-13 (L7): { expiresInDays: 1 | 7 | 30 | null } (7 when left out).
export function createInvite(space, opts) {
  return request(`/spaces/${encodeURIComponent(space)}/invites`, { method: 'POST', ...(opts ? { body: opts } : {}) });
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
// P14-03: email an invite you made (no text of yours goes in).
export function emailInvite(space, code, to) {
  return request(`/spaces/${encodeURIComponent(space)}/invites/${encodeURIComponent(code)}/email`, { method: 'POST', body: { to } });
}
// Public: what an invite link is for, before signing in (P14-01).
export function getInvitePreview(code) {
  return request(`/invites/${encodeURIComponent(code)}/preview`, { auth: false });
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
export function getDmMessages(key, { limit = 50, before, after, around } = {}) {
  const qs = new URLSearchParams(around ? { around } : after ? { limit, after } : before ? { limit, before } : { limit });
  return request(`${dmPath(key)}/messages?${qs}`);
}

// ---- Voice (P11-11): ICE servers and short-lived TURN credentials for calls ----
export function getVoiceIce() {
  return request('/voice/ice');
}

// ---- Current user profile ----
export function getMe() {
  return request('/me');
}
export function updateMe(patch) {
  return request('/me', { method: 'PATCH', body: patch });
}

// ---- Blocking (P9-07b) ----
export function getBlocks() {
  return request('/blocks');
}
export function blockUser(username) {
  return request(`/blocks/${encodeURIComponent(username)}`, { method: 'PUT' });
}
export function unblockUser(username) {
  return request(`/blocks/${encodeURIComponent(username)}`, { method: 'DELETE' });
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
