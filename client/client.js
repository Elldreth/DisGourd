#!/usr/bin/env node
const net = require('net');
const crypto = require('crypto');
const readline = require('readline');

const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT) || 3000;
const space = process.argv[2] || 'default';
const channel = process.argv[3] || 'general';

const socket = net.createConnection({ host, port }, () => {
  const key = crypto.randomBytes(16).toString('base64');
  const headers = [
    `GET /ws/${space}/${channel} HTTP/1.1`,
    `Host: ${host}:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Version: 13',
    `Sec-WebSocket-Key: ${key}`,
    '',
    ''
  ].join('\r\n');
  socket.write(headers);
});

let handshake = false;
let handshakeBuffer = Buffer.alloc(0);
let dataBuffer = Buffer.alloc(0);

socket.on('data', chunk => {
  if (!handshake) {
    handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
    const str = handshakeBuffer.toString();
    const idx = str.indexOf('\r\n\r\n');
    if (idx !== -1) {
      handshake = true;
      const leftover = handshakeBuffer.slice(idx + 4);
      handshakeBuffer = Buffer.alloc(0);
      if (leftover.length) handleFrame(leftover);
    }
  } else {
    handleFrame(chunk);
  }
});

socket.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});

function handleFrame(chunk) {
  dataBuffer = Buffer.concat([dataBuffer, chunk]);
  while (dataBuffer.length >= 2) {
    const length = dataBuffer[1] & 0x7f;
    if (dataBuffer.length < 2 + length) break;
    const message = dataBuffer.slice(2, 2 + length).toString();
    console.log(message);
    dataBuffer = dataBuffer.slice(2 + length);
  }
}

function send(message) {
  const payload = Buffer.from(message);
  const frame = Buffer.alloc(2 + 4 + payload.length);
  frame[0] = 0x81; // FIN + text frame
  frame[1] = 0x80 | payload.length; // mask bit set
  const mask = crypto.randomBytes(4);
  mask.copy(frame, 2);
  for (let i = 0; i < payload.length; i++) {
    frame[6 + i] = payload[i] ^ mask[i % 4];
  }
  socket.write(frame);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', line => {
  if (line.trim().toLowerCase() === '/quit') {
    socket.end();
    rl.close();
  } else {
    send(line.trim());
  }
});
