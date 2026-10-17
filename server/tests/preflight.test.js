// P1-15: the server checks its data folders before anything else and explains
// an unwritable one (usually a volume still owned by root) instead of crashing
// with a stack trace.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkDataDirs } = require('../preflight');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disgourd-preflight-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('writable (or creatable) folders pass', () => {
  expect(checkDataDirs({ DB_PATH: path.join(tmp, 'config', 'disgourd.db'), UPLOADS_DIR: path.join(tmp, 'uploads') })).toBeNull();
  expect(fs.existsSync(path.join(tmp, 'config'))).toBe(true); // created
  expect(fs.readdirSync(path.join(tmp, 'config'))).toEqual([]); // the write probe cleaned up
});

test('an in-memory database needs no folder', () => {
  expect(checkDataDirs({ DB_PATH: ':memory:', UPLOADS_DIR: path.join(tmp, 'uploads2') })).toBeNull();
});

test('an unwritable folder gives one clear message with the fix', () => {
  // A file where the folder should be can't be written into on any OS.
  const blocker = path.join(tmp, 'blocker');
  fs.writeFileSync(blocker, '');
  const msg = checkDataDirs({ DB_PATH: path.join(blocker, 'disgourd.db'), UPLOADS_DIR: path.join(blocker, 'up') });
  expect(msg).toMatch(/can't write to its data folders/);
  expect(msg).toContain(`Database folder: ${blocker}`);
  expect(msg).toContain(`Uploads folder: ${path.join(blocker, 'up')}`);
  expect(msg).toMatch(/chown -R/);
  expect(msg).not.toMatch(/\n\s+at /); // no stack trace
});
