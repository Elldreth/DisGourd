#!/usr/bin/env node
const WebSocket = require('ws');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const http = require('http');

const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT) || 3000;
const space = process.argv[2] || 'default';
const channel = process.argv[3] || 'general';

// Construct the WebSocket URL, e.g., ws://localhost:3000/ws/default/general
const wsUrl = `ws://${host}:${port}/ws/${space}/${channel}`;

console.log(`Connecting to ${wsUrl}...`);

const ws = new WebSocket(wsUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

ws.on('open', () => {
  console.log('Connected to server.');
  rl.prompt();

  rl.on('line', (line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.toLowerCase() === '/quit') {
      ws.close();
      rl.close();
    } else if (trimmedLine.startsWith('/sendfile ')) {
      const filePath = trimmedLine.slice(10).trim();
      const fileName = path.basename(filePath);
      const options = {
        hostname: host,
        port: port,
        path: `/uploads?name=${encodeURIComponent(fileName)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' }
      };
      const reqUp = http.request(options, (res) => {
        let resp = '';
        res.on('data', chunk => resp += chunk);
        res.on('end', () => {
          try {
            const { url } = JSON.parse(resp);
            ws.send(JSON.stringify({ attachment: url }));
          } catch (e) {
            console.error('Upload failed:', e.message);
          }
        });
      });
      reqUp.on('error', (err) => console.error('Upload error:', err.message));
      fs.createReadStream(filePath).pipe(reqUp);
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ content: trimmedLine }));
    }
    rl.prompt();
  });
});

ws.on('message', (data) => {
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  let text = data.toString();
  try {
    const msg = JSON.parse(text);
    if (msg.type === 'history' && Array.isArray(msg.messages)) {
      msg.messages.forEach(m => {
        console.log(formatMessage(m));
      });
    } else if (msg.type === 'system') {
      console.log(`[SYSTEM] ${msg.message}`);
    } else {
      console.log(formatMessage(msg));
    }
  } catch {
    console.log(text);
  }
  rl.prompt(true);
});

function formatMessage(msg) {
  let line = '';
  if (msg.author) line += `${msg.author}: `;
  if (msg.content) line += msg.content;
  if (msg.attachment) line += ` [${msg.attachment}]`;
  if (msg.attachment_url) line += ` [${msg.attachment_url}]`;
  return line;
}

ws.on('close', (code, reason) => {
  console.log(`Disconnected from server. Code: ${code}, Reason: ${reason ? reason.toString() : 'No reason given'}`);
  rl.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
  // Depending on the error, we might want to exit or attempt to reconnect
  if (error.code === 'ECONNREFUSED') {
    console.error(`Connection refused at ${wsUrl}. Ensure the server is running.`);
  }
  rl.close(); 
  process.exit(1); // Exit on error
});

// Handle Ctrl+C to gracefully close the connection
rl.on('SIGINT', () => {
  console.log('\nClosing connection...');
  ws.close();
  rl.close();
});
