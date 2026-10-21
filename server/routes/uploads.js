// File uploads: streaming POST /uploads and serving files from the uploads directory.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authUserId } = require('../auth/tokens');
const { intParam } = require('../http/util');
const db = require('../db');
const uploadsGc = require('../uploadsGc');

// ---- File uploads ----
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'uploads');
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 25 * 1024 * 1024; // 25 MB default
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) || 1;

// Executable / script types we refuse outright. Everything else is accepted;
// anything that isn't known-safe media is served as a download, never inline.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl',
  '.jar', '.msc', '.vbs', '.vbe', '.ws', '.wsf', '.wsh', '.ps1', '.psm1',
  '.sh', '.bash', '.app', '.deb', '.rpm', '.dmg',
]);

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain',
  '.log': 'text/plain', '.json': 'application/json', '.csv': 'text/csv',
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Types safe to render inline in a browser. SVG is intentionally excluded — it
// can carry scripts — and is served as a download instead.
const INLINE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif',
  '.mp4', '.webm', '.mov', '.mp3', '.ogg', '.wav', '.m4a', '.pdf',
]);

function sanitizeFilename(name) {
  const base = path.basename(String(name));
  // Replace characters illegal on Windows/most filesystems and control chars,
  // and never let a name start with dots (hidden / traversal-looking).
  const cleaned = base
    .replace(/[<>:"/\\|?*]/g, '_')            // filesystem-illegal characters
    .split('').filter(ch => ch.charCodeAt(0) > 31).join('') // drop control chars
    .replace(/^\.+/, '_')                     // no leading dots (hidden/traversal)
    .trim();
  return cleaned.slice(0, 200) || 'file';
}

// The file behind one of our own upload URLs (/uploads/<token>/<name>), or
// null if the URL doesn't point inside the uploads directory. Used by
// features that attach an existing upload (server emoji).
function uploadFilePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  let rest;
  try {
    rest = decodeURIComponent(url.slice('/uploads/'.length));
  } catch {
    return null;
  }
  const filePath = path.join(UPLOADS_DIR, path.normalize(rest).replace(/^(\.\.[\/\\])+/, ''));
  if (filePath === UPLOADS_DIR || !filePath.startsWith(UPLOADS_DIR + path.sep)) return null;
  return filePath;
}

function uploadTooLargeError() {
  return `File exceeds the ${MAX_UPLOAD_MB} MB limit`;
}

// Tried in order; the first match handles the request.
const routes = [
  {
    // Endpoint to handle file uploads
    match: ({ req, parsedUrl }) => req.method === 'POST' && parsedUrl.pathname === '/uploads',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      if (!parsedUrl.query.name || typeof parsedUrl.query.name !== 'string') {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Missing filename' }));
      }
      const safeName = sanitizeFilename(parsedUrl.query.name);
      const ext = path.extname(safeName).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        res.writeHead(415);
        return res.end(JSON.stringify({ error: 'That file type is not allowed' }));
      }
      // Reject early if the client already tells us it is too big.
      const declared = intParam(req.headers['content-length'], 0, 0, Number.MAX_SAFE_INTEGER);
      if (declared && declared > MAX_UPLOAD_BYTES) {
        res.writeHead(413);
        return res.end(JSON.stringify({ error: uploadTooLargeError() }));
      }
      // P11-04: the server's total cap, and each person's daily quota (site
      // admins exempt), checked up front and again while the body arrives.
      const maxTotal = uploadsGc.maxTotalBytes();
      if (maxTotal && uploadsGc.totalBytes() + declared >= maxTotal) {
        res.writeHead(507);
        return res.end(JSON.stringify({ error: "The server's upload space is full. Ask the admin to free some up." }));
      }
      const quota = db.isSiteAdmin(userId) ? Infinity : uploadsGc.quotaBytes();
      const usedBefore = Number.isFinite(quota) ? uploadsGc.usedToday(userId) : 0;
      const quotaError = () => `You've uploaded ${Math.round(quota / (1024 * 1024)) || 1} MB today, the most for one day. Try again tomorrow.`;
      if (usedBefore + declared > quota) {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: quotaError() }));
      }

      // Each upload lands in its own random subdirectory so identical filenames
      // never overwrite one another, while the original name is preserved for a
      // clean download experience.
      const token = crypto.randomBytes(9).toString('hex');
      const destDir = path.join(UPLOADS_DIR, token);
      fs.mkdirSync(destDir, { recursive: true });
      const filePath = path.join(destDir, safeName);
      const writeStream = fs.createWriteStream(filePath);

      let received = 0;
      let aborted = false;
      const failWith = (code, message) => {
        if (aborted) return;
        aborted = true;
        writeStream.destroy();
        fs.rm(destDir, { recursive: true, force: true }, () => {});
        if (!res.headersSent) {
          res.writeHead(code);
          res.end(JSON.stringify({ error: message }));
        }
      };

      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          failWith(413, uploadTooLargeError());
          req.destroy();
        } else if (usedBefore + received > quota) {
          failWith(429, quotaError());
          req.destroy();
        }
      });
      req.on('error', () => failWith(400, 'Upload failed'));
      writeStream.on('error', () => failWith(500, 'Could not save file'));
      writeStream.on('finish', () => {
        if (aborted) return;
        uploadsGc.recordUpload(token, userId, received); // P11-04: counts toward the quota
        const url = `/uploads/${token}/${encodeURIComponent(safeName)}`;
        res.writeHead(201);
        res.end(JSON.stringify({
          url,
          name: safeName,
          size: received,
          type: CONTENT_TYPES[ext] || 'application/octet-stream',
          inline: INLINE_EXTENSIONS.has(ext),
        }));
      });
      req.pipe(writeStream);
      return;
    },
  },
  {
    // Serve uploaded files
    match: ({ req, parsedUrl }) => req.method === 'GET' && parsedUrl.pathname.startsWith('/uploads/'),
    run: async ({ res, parsedUrl }) => {
      let requestedPath;
      try {
        requestedPath = decodeURIComponent(parsedUrl.pathname.substring('/uploads/'.length));
      } catch {
        res.writeHead(400);
        return res.end('Bad request');
      }
      const safeSuffix = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(UPLOADS_DIR, safeSuffix);
      // Ensure the resolved path stays inside the uploads directory.
      if (filePath !== UPLOADS_DIR && !filePath.startsWith(UPLOADS_DIR + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      fs.readFile(filePath, (err, content) => {
        if (err) {
          if (err.code === 'ENOENT' || err.code === 'EISDIR') {
            res.writeHead(404);
            res.end('File not found');
          } else {
            res.writeHead(500);
            res.end('Error loading file');
          }
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
        const inline = INLINE_EXTENSIONS.has(ext);
        const downloadName = path.basename(filePath);
        const asciiName = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
        res.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          // P11-04: never runs as a page on our origin (images, video and
          // audio in <img>/<video> are unaffected), and isn't for other sites.
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Disposition':
            `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
          // P11-04: private (no shared caches such as Cloudflare's edge) and a
          // day, so a deleted file stops being served soon after.
          'Cache-Control': 'private, max-age=86400',
        });
        res.end(content);
      });
      return;
    },
  },
];

// Returns true when one of these routes handled the request.
async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle, uploadFilePath, CONTENT_TYPES, UPLOADS_DIR };
