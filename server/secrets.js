// Secrets from the environment (P11-14): NAME, else the file named by
// NAME_FILE (Docker / compose secrets under /run/secrets, so the value isn't
// in `docker inspect`). A file is read once and remembered. A NAME_FILE that
// can't be read throws, so a typo stops the start instead of silently going
// without the secret.
const fs = require('fs');

const fromFiles = new Map();

function secretFromEnv(name, env = process.env) {
  const direct = String(env[name] || '').trim();
  if (direct) return direct;
  const file = env[`${name}_FILE`];
  if (!file) return '';
  if (!fromFiles.has(file)) {
    try {
      fromFiles.set(file, fs.readFileSync(file, 'utf8').trim());
    } catch (err) {
      throw new Error(`${name}_FILE: couldn't read ${file} (${err.code || err.message})`);
    }
  }
  return fromFiles.get(file);
}

module.exports = { secretFromEnv };
