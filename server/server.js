const http = require('http');
const crypto = require('crypto');
const url = require('url');

// In-memory store for spaces and channels
const spaces = {};

function createSpace(name) {
  if (!spaces[name]) {
    spaces[name] = { channels: {} };
  }
  return spaces[name];
}

function createChannel(space, channel) {
  const sp = createSpace(space);
  if (!sp.channels[channel]) {
    sp.channels[channel] = { clients: new Set() };
  }
  return sp.channels[channel];
}

function broadcast(channelObj, message, sender) {
  channelObj.clients.forEach(client => {
    if (client !== sender && client.writable) {
      client.write(`\x81${String.fromCharCode(message.length)}${message}`);
    }
  });
}

const server = http.createServer((req, res) => {
  // API endpoints for creating spaces and channels
  const parsed = url.parse(req.url, true);
  if (req.method === 'POST') {
    if (parsed.pathname === '/space') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const { name } = JSON.parse(body || '{}');
        if (!name) {
          res.writeHead(400);
          return res.end('Name required');
        }
        createSpace(name);
        res.writeHead(201);
        res.end('Created');
      });
    } else if (parsed.pathname.startsWith('/space/') && parsed.pathname.endsWith('/channel')) {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const space = parsed.pathname.split('/')[2];
        const { name } = JSON.parse(body || '{}');
        if (!name) {
          res.writeHead(400);
          return res.end('Name required');
        }
        createChannel(space, name);
        res.writeHead(201);
        res.end('Created');
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('upgrade', (req, socket) => {
  const parsed = url.parse(req.url);
  const match = /^\/ws\/([^/]+)\/([^/]+)/.exec(parsed.pathname || '');
  if (!match) {
    socket.destroy();
    return;
  }
  const space = match[1];
  const channel = match[2];
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
  ];
  socket.write(headers.concat('\r\n').join('\r\n'));

  const ch = createChannel(space, channel);
  ch.clients.add(socket);

  socket.on('data', buffer => {
    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;
    if (opcode === 0x8) {
      ch.clients.delete(socket);
      socket.end();
      return;
    }
    const secondByte = buffer[1];
    const length = secondByte & 0x7f;
    let maskStart = 2;
    if (length === 126) maskStart = 4;
    else if (length === 127) maskStart = 10;
    const mask = buffer.slice(maskStart, maskStart + 4);
    const dataStart = maskStart + 4;
    const payload = buffer.slice(dataStart, dataStart + length);
    const unmasked = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      unmasked[i] = payload[i] ^ mask[i % 4];
    }
    const message = unmasked.toString();
    broadcast(ch, message, socket);
  });

  socket.on('close', () => {
    ch.clients.delete(socket);
  });
});

const config = require('./config.json');
server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
