const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();
const db = require('./db');

let config = { port: 3000, jwtSecret: 'changeme' };
try {
    const configFile = require('./config.json');
    config = { ...config, ...configFile };
} catch (e) {
    console.warn('config.json not found or unreadable, using defaults.');
}

config.port = parseInt(process.env.PORT, 10) || config.port;
config.jwtSecret = process.env.JWT_SECRET || config.jwtSecret;

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function createToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [headerB, payloadB, signature] = token.split('.');
    const data = `${headerB}.${payloadB}`;
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
    if (expected !== signature) return null;
    const payload = JSON.parse(Buffer.from(payloadB, 'base64url').toString('utf8'));
    return payload;
  } catch {
    return null;
  }
}

function authUserId(req, parsedUrl) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ')
    ? auth.slice(7)
    : (parsedUrl.query && parsedUrl.query.token);
  if (!token) return null;
  const payload = verifyToken(token);
  return payload ? payload.sub : null;
}

// In-memory stores for tracking connected clients and presence
const clientSpaces = {}; // { spaceName: { channels: { channelName: { clients: Set<WebSocket> } } } }
const userClients = {}; // { userId: Set<WebSocket> }

function createSpace(name) {
  db.createSpace(name);
  if (!clientSpaces[name]) {
    clientSpaces[name] = { channels: {} };
    console.log(`Space created: ${name}`);
  }
  return clientSpaces[name];
}

function createChannel(spaceName, channelName) {
  db.createChannel(spaceName, channelName);
  if (!clientSpaces[spaceName]) {
    clientSpaces[spaceName] = { channels: {} };
  }
  if (!clientSpaces[spaceName].channels[channelName]) {
    clientSpaces[spaceName].channels[channelName] = { clients: new Set() };
    console.log(`Channel created: ${channelName} in space ${spaceName}`);
  }
  return clientSpaces[spaceName].channels[channelName];
}

function notifyAndDisconnectClients(clients, systemMessage, closeReasonCode = 1000, closeReasonMessage = 'Resource deleted by admin') {
  if (!clients) return;
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (systemMessage) {
        client.send(JSON.stringify({ type: 'system', message: systemMessage }));
      }
      client.close(closeReasonCode, closeReasonMessage);
    }
  });
}

function broadcast(channelObj, message, senderClient) {
  // message is already a string or Buffer from ws library
  if (!channelObj || !channelObj.clients) return;

  channelObj.clients.forEach(client => {
    // ws clients have a readyState property
    if (client !== senderClient && client.readyState === WebSocket.OPEN) {
      client.send(message); // ws handles framing
    }
  });
}

function sendPresenceUpdate(userId, status) {
  const user = db.getUserById(userId);
  if (!user) return;
  const friends = db.getFriends(userId);
  friends.forEach(f => {
    const set = userClients[f.id];
    if (set) {
      set.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'presence', user: user.username, status }));
        }
      });
    }
  });
}

function sendFriendList(wsClient) {
  const friends = db.getFriends(wsClient.userId);
  const list = friends.map(f => ({
    username: f.username,
    online: !!(userClients[f.id] && userClients[f.id].size > 0)
  }));
  wsClient.send(JSON.stringify({ type: 'friend_list', friends: list }));
}

// Create HTTP server
const httpServer = http.createServer(async (req, res) => { // Made async for potential await with body parsing
  const parsedUrl = url.parse(req.url, true);
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean); // e.g., ['admin', 'spaces', 'spaceName']

  // Helper to parse JSON body
  const getJsonBody = (request) => {
    return new Promise((resolve, reject) => {
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        }
        catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      request.on('error', (err) => reject(err));
    });
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsedUrl.pathname === '/register' && req.method === 'POST') {
    try {
      const { username, password, email } = await getJsonBody(req);
      if (!username || !password || !email) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Username, password and email required' }));
      }
      if (db.getUserByUsername(username) || db.getUserByEmail(email)) {
        res.writeHead(409);
        return res.end(JSON.stringify({ error: 'User already exists' }));
      }
      const salt = generateSalt();
      const hash = hashPassword(password, salt);
      const userId = db.createUser(username, email, hash, salt);
      const token = createToken(userId);
      res.writeHead(201);
      return res.end(JSON.stringify({ token }));
    } catch (e) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  else if (parsedUrl.pathname === '/login' && req.method === 'POST') {
    try {
      const { username, password } = await getJsonBody(req);
      const user = db.getUserByUsername(username);
      if (!user || hashPassword(password, user.salt) !== user.password_hash) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }
      const token = createToken(user.id);
      res.writeHead(200);
      return res.end(JSON.stringify({ token }));
    } catch (e) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  else if (pathSegments[0] === 'friends' && pathSegments.length === 1 && req.method === 'GET') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const friends = db.getFriends(userId).map(u => ({ username: u.username }));
    res.writeHead(200);
    return res.end(JSON.stringify({ friends }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'requests' && req.method === 'GET') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const reqs = db.getIncomingFriendRequests(userId).map(r => db.getUserById(r.from_user)?.username).filter(Boolean);
    res.writeHead(200);
    return res.end(JSON.stringify({ requests: reqs }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'request' && req.method === 'POST') {
    const fromId = authUserId(req, parsedUrl);
    if (!fromId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const to = db.getUserByUsername(username);
    if (!to) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.createFriendRequest(fromId, to.id);
    res.writeHead(201);
    return res.end(JSON.stringify({ message: 'Request sent' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'accept' && req.method === 'POST') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const fromUser = db.getUserByUsername(username);
    if (!fromUser) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.removeFriendRequest(fromUser.id, userId);
    db.addFriends(userId, fromUser.id);
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Friend added' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'reject' && req.method === 'POST') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const fromUser = db.getUserByUsername(username);
    if (fromUser) { db.removeFriendRequest(fromUser.id, userId); }
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Request removed' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] && req.method === 'DELETE') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const other = db.getUserByUsername(pathSegments[1]);
    if (!other) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.removeFriend(userId, other.id);
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Friend removed' }));
  }
  else if (
    pathSegments[0] === 'spaces' &&
    pathSegments[2] === 'channels' &&
    pathSegments[4] === 'messages' &&
    req.method === 'GET'
  ) {
    const spaceName = pathSegments[1];
    const channelName = pathSegments[3];
    const limit = parseInt(parsedUrl.query.limit || '20', 10);
    const offset = parseInt(parsedUrl.query.offset || '0', 10);
    const messages = db.getMessages(spaceName, channelName, limit, offset);
    res.writeHead(200);
    return res.end(JSON.stringify(messages));
  }

  // Admin API Routes
  if (pathSegments[0] === 'admin') {
    // Serve admin.html for GET /admin
    if (pathSegments.length === 1 && req.method === 'GET') {
      const filePath = path.join(__dirname, '..', 'public', 'admin.html');
      fs.readFile(filePath, (err, content) => {
        if (err) {
          console.error('Error loading admin.html:', err);
          res.writeHead(500);
          return res.end('Error loading admin page. Check server logs.');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
      return; // Prevent fall-through to other handlers
    } 
    // API endpoint for GET /admin/state
    else if (pathSegments[1] === 'state' && req.method === 'GET') {
      const state = db.getState();
      for (const spaceName in state) {
        for (const channelName in state[spaceName].channels) {
          const count =
            clientSpaces[spaceName] && clientSpaces[spaceName].channels[channelName]
              ? clientSpaces[spaceName].channels[channelName].clients.size
              : 0;
          state[spaceName].channels[channelName].clientCount = count;
        }
      }
      res.writeHead(200);
      return res.end(JSON.stringify(state));
    }
    // POST /admin/spaces
    else if (pathSegments[1] === 'spaces' && !pathSegments[2] && req.method === 'POST') {
      try {
        const { name } = await getJsonBody(req);
        if (!name) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Space name required' }));
        }
        createSpace(name);
        res.writeHead(201);
        return res.end(JSON.stringify({ message: 'Space created', name }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // PUT /admin/spaces/:spaceName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && !pathSegments[3] && req.method === 'PUT') {
      const oldName = pathSegments[2];
      const state = db.getState();
      if (!state[oldName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      try {
        const { name: newName } = await getJsonBody(req);
        if (!newName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'New name required' }));
        }
        const success = db.renameSpace(oldName, newName);
        if (!success) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: 'Space name already exists' }));
        }
        if (clientSpaces[oldName]) {
          for (const channelName in clientSpaces[oldName].channels) {
            notifyAndDisconnectClients(
              clientSpaces[oldName].channels[channelName].clients,
              `Space '${oldName}' renamed to '${newName}' by an administrator.`,
              1000,
              'Space renamed by admin'
            );
          }
          clientSpaces[newName] = clientSpaces[oldName];
          delete clientSpaces[oldName];
        }
        console.log(`Admin renamed space '${oldName}' to '${newName}'`);
        res.writeHead(200);
        return res.end(JSON.stringify({ message: `Space renamed`, name: newName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // DELETE /admin/spaces/:spaceName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && !pathSegments[3] && req.method === 'DELETE') {
      const spaceName = pathSegments[2];
      const state = db.getState();
      if (!state[spaceName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      if (clientSpaces[spaceName]) {
        for (const channelName in clientSpaces[spaceName].channels) {
          const channelObj = clientSpaces[spaceName].channels[channelName];
          notifyAndDisconnectClients(
            channelObj.clients,
            `Space '${spaceName}' (channel '${channelName}') is being deleted by an administrator.`,
            1000,
            'Space deleted by admin'
          );
        }
      }
      db.deleteSpace(spaceName);
      delete clientSpaces[spaceName];
      console.log(`Admin deleted space: ${spaceName}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Space '${spaceName}' deleted` }));
    }
    // POST /admin/spaces/:spaceName/channels
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && !pathSegments[4] && req.method === 'POST') {
      const spaceName = pathSegments[2];
      const state = db.getState();
      if (!state[spaceName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      try {
        const { name: channelName } = await getJsonBody(req);
        if (!channelName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Channel name required' }));
        }
        createChannel(spaceName, channelName);
        res.writeHead(201);
        return res.end(JSON.stringify({ message: 'Channel created', space: spaceName, channel: channelName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // PUT /admin/spaces/:spaceName/channels/:channelName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && pathSegments[4] && req.method === 'PUT') {
      const spaceName = pathSegments[2];
      const oldChan = pathSegments[4];
      const state = db.getState();
      if (!state[spaceName] || !state[spaceName].channels[oldChan]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space or Channel not found' }));
      }
      try {
        const { name: newName } = await getJsonBody(req);
        if (!newName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'New name required' }));
        }
        const success = db.renameChannel(spaceName, oldChan, newName);
        if (!success) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: 'Channel name already exists' }));
        }
        const spaceObj = clientSpaces[spaceName];
        if (spaceObj && spaceObj.channels[oldChan]) {
          notifyAndDisconnectClients(
            spaceObj.channels[oldChan].clients,
            `Channel '${oldChan}' renamed to '${newName}' by an administrator.`,
            1000,
            'Channel renamed by admin'
          );
          spaceObj.channels[newName] = spaceObj.channels[oldChan];
          delete spaceObj.channels[oldChan];
        }
        console.log(`Admin renamed channel '${oldChan}' to '${newName}' in space '${spaceName}'`);
        res.writeHead(200);
        return res.end(JSON.stringify({ message: 'Channel renamed', name: newName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // DELETE /admin/spaces/:spaceName/channels/:channelName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && pathSegments[4] && req.method === 'DELETE') {
      const spaceName = pathSegments[2];
      const channelName = pathSegments[4];
      const state = db.getState();
      if (!state[spaceName] || !state[spaceName].channels[channelName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space or Channel not found' }));
      }
      const channelObj = clientSpaces[spaceName] && clientSpaces[spaceName].channels[channelName];
      notifyAndDisconnectClients(
        channelObj ? channelObj.clients : null,
        `Channel '${channelName}' in space '${spaceName}' is being deleted by an administrator.`,
        1000,
        'Channel deleted by admin'
      );
      db.deleteChannel(spaceName, channelName);
      if (clientSpaces[spaceName]) {
        delete clientSpaces[spaceName].channels[channelName];
      }
      console.log(`Admin deleted channel: ${channelName} from space: ${spaceName}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Channel '${channelName}' in space '${spaceName}' deleted` }));
    }
    else {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Admin endpoint not found' }));
    }
  }
  // Endpoint to handle file uploads
  else if (req.method === 'POST' && parsedUrl.pathname === '/uploads') {
    const filename = parsedUrl.query.name;
    if (!filename) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Missing filename' }));
    }
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = path.basename(filename);
    const filePath = path.join(uploadsDir, safeName);
    const writeStream = fs.createWriteStream(filePath);
    req.pipe(writeStream);
    req.on('end', () => {
      const urlPath = `/uploads/${safeName}`;
      res.writeHead(201);
      res.end(JSON.stringify({ url: urlPath }));
    });
    return;
  }
  // Serve uploaded files
  else if (req.method === 'GET' && parsedUrl.pathname.startsWith('/uploads/')) {
    const requestedPath = parsedUrl.pathname.substring('/uploads/'.length);
    const safeSuffix = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, '..', 'uploads', safeSuffix);
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!filePath.startsWith(uploadsDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('File not found');
        } else {
          res.writeHead(500);
          res.end('Error loading file');
        }
        return;
      }
      res.writeHead(200);
      res.end(content);
    });
    return;
  }
  // Serve static files from 'public' directory
  else if (req.method === 'GET' && parsedUrl.pathname.startsWith('/public/')) {
    const requestedPath = parsedUrl.pathname.substring('/public/'.length);
    const safeSuffix = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, ''); // Prevent directory traversal
    const filePath = path.join(__dirname, '..', 'public', safeSuffix);

    // Ensure the resolved path is still within the public directory
    const publicDir = path.join(__dirname, '..', 'public');
    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          console.warn(`Static file not found: ${filePath}`);
          res.writeHead(404);
          res.end('Static file not found.');
        } else {
          console.error(`Error loading static file ${filePath}:`, err);
          res.writeHead(500);
          res.end('Error loading static file.');
        }
        return;
      }

      let contentType = 'text/plain';
      if (filePath.endsWith('.css')) {
        contentType = 'text/css';
      } else if (filePath.endsWith('.js')) {
        contentType = 'application/javascript';
      } else if (filePath.endsWith('.html')) {
        contentType = 'text/html';
      } else if (filePath.endsWith('.png')) {
        contentType = 'image/png';
      } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (filePath.endsWith('.gif')) {
        contentType = 'image/gif';
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
    return; // Prevent fall-through to other handlers
  }
  // Legacy API endpoints (optional, could be removed or aliased)
  else if (req.method === 'POST') {
    if (parsedUrl.pathname === '/space') {
      // This is now handled by POST /admin/spaces
      res.writeHead(405); // Method Not Allowed or redirect
      return res.end(JSON.stringify({ error: 'Deprecated. Use POST /admin/spaces' }));
    } else if (parsedUrl.pathname.startsWith('/space/') && parsedUrl.pathname.endsWith('/channel')) {
      // This is now handled by POST /admin/spaces/:spaceName/channels
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Deprecated. Use POST /admin/spaces/:spaceName/channels' }));
    }
  }

  // Default response for non-API GET requests or unhandled routes
  if (req.method === 'GET' && parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('DisGourd Server is running. WebSocket connections at /ws/:space/:channel. Admin API at /admin/*');
  }
  
  // Fallback for any other unhandled requests
  if (!res.writableEnded) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
 else {
    // For GET requests or other methods, you might serve a status page or similar
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DisGourd Server is running. WebSocket connections at /ws/:space/:channel');
  }
});

// Create WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ noServer: true }); // noServer: true allows us to use existing HTTP server for handshake

httpServer.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url, true);
  const match = /^\/ws\/([^/]+)\/([^/]+)/.exec(parsedUrl.pathname || '');

  if (match) {
    const spaceName = match[1];
    const channelName = match[2];

    const token = parsedUrl.query && parsedUrl.query.token;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      socket.destroy();
      return;
    }

    // Ensure channel exists before upgrading
    const channelObj = createChannel(spaceName, channelName);

    wss.handleUpgrade(request, socket, head, (wsClient) => {
      // Store the space and channel info on the wsClient object for later use
      wsClient.spaceName = spaceName;
      wsClient.channelName = channelName;
      wsClient.userId = payload.sub;

      channelObj.clients.add(wsClient);
      const uc = userClients[wsClient.userId] || (userClients[wsClient.userId] = new Set());
      uc.add(wsClient);
      if (uc.size === 1) sendPresenceUpdate(wsClient.userId, 'online');
      sendFriendList(wsClient);
      console.log(`Client connected to ${spaceName}/${channelName}. Total clients in channel: ${channelObj.clients.size}`);
      
      // Let the new client know they're connected (optional)
      wsClient.send(JSON.stringify({ type: 'system', message: `Connected to ${spaceName}/${channelName}` }));

      const historyCount = parseInt(parsedUrl.query.history || '0', 10);
      if (historyCount > 0) {
        const history = db.getMessages(spaceName, channelName, historyCount, 0);
        wsClient.send(JSON.stringify({ type: 'history', messages: history }));
      }

      wsClient.on('message', (message) => {
        // message is already unmasked and can be Buffer or String
        const msgText = message.toString();
        console.log(`Received from ${spaceName}/${channelName}: ${msgText}`);
        let parsed;
        try {
          parsed = JSON.parse(msgText);
        } catch {
          parsed = { content: msgText };
        }
        const { content = '', attachment } = parsed;
        const user = db.getUserById(wsClient.userId);
        const broadcastObj = {
          content,
          attachment,
          author: user ? user.username : wsClient.userId,
          timestamp: Date.now()
        };
        db.storeMessage(spaceName, channelName, content, wsClient.userId, attachment);
        broadcast(channelObj, JSON.stringify(broadcastObj), wsClient);
      });

      wsClient.on('close', (code, reason) => {
        channelObj.clients.delete(wsClient);
        const set = userClients[wsClient.userId];
        if (set) {
          set.delete(wsClient);
          if (set.size === 0) {
            delete userClients[wsClient.userId];
            sendPresenceUpdate(wsClient.userId, 'offline');
          }
        }
        console.log(`Client disconnected from ${spaceName}/${channelName}. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}. Remaining clients: ${channelObj.clients.size}`);
      });

      wsClient.on('error', (error) => {
        console.error(`WebSocket error on client from ${spaceName}/${channelName}:`, error);
        // Ensure client is removed on error too
        channelObj.clients.delete(wsClient);
        const set = userClients[wsClient.userId];
        if (set) {
          set.delete(wsClient);
          if (set.size === 0) {
            delete userClients[wsClient.userId];
            sendPresenceUpdate(wsClient.userId, 'offline');
          }
        }
      });
    });
  } else {
    // If the path doesn't match our WebSocket endpoint, destroy the socket
    console.log('WebSocket upgrade request for unknown path, destroying socket.');
    socket.destroy();
  }
});

if (require.main === module) {
  httpServer.listen(config.port, () => {
    console.log(`DisGourd Server running on port ${config.port}`);
    console.log(`WebSocket connections available at ws://localhost:${config.port}/ws/:space/:channel`);
  });
}

module.exports = { httpServer, wss, config };
