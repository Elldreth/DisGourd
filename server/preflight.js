// Before anything touches the disk: can we write to the database and uploads
// folders? The usual way this fails is a Docker volume still owned by root
// after the container switched to a non-root user; say so plainly (with the
// fix) instead of crashing later with an EACCES stack trace.
const fs = require('fs');
const path = require('path');

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return null;
  } catch (err) {
    return err.code || err.message;
  }
}

// Returns null when all is well, or a ready-to-print explanation.
function checkDataDirs(env = process.env) {
  const dbPath = env.DB_PATH || path.join(__dirname, 'db', 'disgourd.db');
  const uploads = env.UPLOADS_DIR ? path.resolve(env.UPLOADS_DIR) : path.join(__dirname, '..', 'uploads');
  const dirs = [];
  if (dbPath !== ':memory:') dirs.push(['Database folder', path.dirname(path.resolve(dbPath))]);
  dirs.push(['Uploads folder', uploads]);

  const problems = dirs.map(([label, dir]) => [label, dir, writable(dir)]).filter((p) => p[2]);
  if (problems.length === 0) return null;

  const who = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : 'this user';
  return [
    '',
    `  DisGourd can't write to its data folders (running as ${who}):`,
    ...problems.map(([label, dir, code]) => `    ${label}: ${dir}  (${code})`),
    '',
    '  If this is Docker, the host folders behind these volumes are probably still',
    '  owned by root from an older image. Give them to the user the container runs',
    `  as, once, on the host, e.g.:  chown -R ${who === 'this user' ? '99:100' : who} <host folder>`,
    '  (see "Upgrading to the non-root image" in the README).',
    '',
  ].join('\n');
}

module.exports = { checkDataDirs };
