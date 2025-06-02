#!/usr/bin/env node
const WebSocket = require('ws');
const readline = require('readline');

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
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(trimmedLine);
    }
    rl.prompt();
  });
});

ws.on('message', (data) => {
  // ws library gives us the message payload directly
  // For text messages, it's usually a string or a Buffer that can be toString()'d
  // Clear the current line, print the message, then re-display the prompt
  process.stdout.clearLine(0); 
  process.stdout.cursorTo(0);
  console.log(data.toString());
  rl.prompt(true); // true to preserve current input
});

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
