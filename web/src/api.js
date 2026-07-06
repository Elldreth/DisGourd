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

// ---- Servers (spaces) / channels ----
// Only servers the current user belongs to are returned.
export function getSpaces() {
  return request('/spaces');
}
export function createSpace(name) {
  return request('/spaces', { method: 'POST', body: { name } });
}
export function deleteSpace(space) {
  return request(`/spaces/${encodeURIComponent(space)}`, { method: 'DELETE' });
}
export function setSpaceIcon(space, icon) {
  return request(`/spaces/${encodeURIComponent(space)}`, { method: 'PATCH', body: { icon } });
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
export function getMessages(space, channel, { limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  return request(
    `/spaces/${encodeURIComponent(space)}/channels/${encodeURIComponent(channel)}/messages?${qs}`
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
export function getDmMessages(username, { limit = 50 } = {}) {
  const qs = new URLSearchParams({ limit });
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
