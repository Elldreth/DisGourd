#!/usr/bin/env node
// P11-14: print the secrets DisGourd generated into files (.jwt-secret,
// .vapid.json) as environment lines, to move them into the host's secret
// store or env file. Reads files only; changes nothing.
//
//   node server/scripts/print-secrets-env.js [folder]
//
// The folder is the one holding the database (/config in Docker). Without
// one: the folder of DB_PATH, else server/. JWT_SECRET_FILE and
// VAPID_KEYS_FILE point at the files directly, as they do for the server.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2]
  || (process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..'));
const jwtFile = process.argv[2] ? path.join(dir, '.jwt-secret') : process.env.JWT_SECRET_FILE || path.join(dir, '.jwt-secret');
const vapidFile = process.argv[2] ? path.join(dir, '.vapid.json') : process.env.VAPID_KEYS_FILE || path.join(dir, '.vapid.json');

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    console.error(`# not found: ${file}`);
    return null;
  }
};

const lines = [];
const jwt = read(jwtFile);
if (jwt && jwt.trim()) lines.push(`JWT_SECRET=${jwt.trim()}`);
const vapid = read(vapidFile);
if (vapid) {
  try {
    const keys = JSON.parse(vapid);
    if (keys.publicKey && keys.privateKey) lines.push(`VAPID_PUBLIC_KEY=${keys.publicKey}`, `VAPID_PRIVATE_KEY=${keys.privateKey}`);
  } catch {
    console.error(`# not valid JSON: ${vapidFile}`);
  }
}

if (!lines.length) {
  console.error('# Nothing to print.');
  process.exit(1);
}
console.error('# Secrets: put these in the host\'s secret store or a 0600 env file, never in git.');
console.log(lines.join('\n'));
