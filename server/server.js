const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ quiet: true });

// First: can we write our data? (Before the database or the secret file are touched.)
const dataProblem = require('./preflight').checkDataDirs();
if (dataProblem) {
  console.error(dataProblem);
  if (require.main === module) process.exit(1);
  throw new Error('DisGourd cannot write to its data folders');
}
const db = require('./db');
const { config, registrationMode, isWeakSecret, resolveJwtSecret } = require('./config');
const { clientIp } = require('./auth/rateLimit');
const { MAX_WS_PAYLOAD_BYTES } = require('./http/util');
const { handleHttp, handleHttpError } = require('./http/handler');
const { WEB_DIST } = require('./static');
const { attachGateway } = require('./gateway');
const { backupSettings, startBackupSchedule } = require('./backup');

// Create HTTP server
const httpServer = http.createServer((req, res) => {
  handleHttp(req, res).catch((err) => handleHttpError(res, err));
});

// Create WebSocket server and attach it to the HTTP server
// noServer: the HTTP server above performs the handshake. maxPayload replaces
// ws's 100 MiB default; oversized frames close the socket (code 1009).
const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });

attachGateway(httpServer, wss);

if (require.main === module) {
  httpServer.listen(config.port, () => {
    const hasBuild = fs.existsSync(path.join(WEB_DIST, 'index.html'));
    console.log(`\n  DisGourd is running 🥒`);
    console.log(`  → Open http://localhost:${config.port} in your browser\n`);
    const reg = registrationMode();
    console.log(`  Registration: ${reg}${reg === 'code' ? ' (a code is required — manage them in Settings)' : ''}${config.maxAccounts ? ` · max ${config.maxAccounts} accounts` : ''}`);
    console.log('');
    if (!hasBuild) {
      console.log('  Note: the web client is not built yet. Run `npm run build` (or `npm run dev`');
      console.log('  for the hot-reloading dev server) to see the UI.\n');
    }
    // Only when run directly, so tests never start the backup timer.
    const backups = backupSettings();
    if (backups) {
      console.log(`  Backups: every ${backups.intervalHours}h to ${backups.dir} (keeping ${backups.keep})\n`);
      startBackupSchedule({ db: db.raw, ...backups });
    }
  });
}

module.exports = { httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp };
