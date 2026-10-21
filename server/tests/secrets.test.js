// P11-14: secrets from the environment (or a *_FILE, for Docker secrets),
// VAPID keys from the environment, and a warning when a kie.ai key is both in
// the environment and saved in the database.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-secrets-${process.pid}`);

const webpush = require('web-push');
const { secretFromEnv } = require('../secrets');
const push = require('../push');
const kie = require('../imagine/engines/kie');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-secrets-'));
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));
const file = (name, text) => {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, text);
  return p;
};

describe('secretFromEnv', () => {
  test('the variable wins, then NAME_FILE (trimmed), else empty', () => {
    const p = file('one.txt', '  from-file\n');
    expect(secretFromEnv('X_KEY', { X_KEY: ' from-env ', X_KEY_FILE: p })).toBe('from-env');
    expect(secretFromEnv('X_KEY', { X_KEY_FILE: p })).toBe('from-file');
    expect(secretFromEnv('X_KEY', {})).toBe('');
  });

  test('a NAME_FILE that can’t be read stops with a message naming it', () => {
    expect(() => secretFromEnv('X_KEY', { X_KEY_FILE: path.join(DIR, 'missing.txt') })).toThrow(/X_KEY_FILE.*missing\.txt/);
  });
});

describe('VAPID keys from the environment', () => {
  const pair = webpush.generateVAPIDKeys();

  test('both set: those keys are used, and no file is written', () => {
    const keysFile = path.join(DIR, '.vapid.json');
    const env = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey };
    expect(push.loadKeys({ env, file: keysFile, ephemeral: false })).toEqual(pair);
    expect(fs.existsSync(keysFile)).toBe(false);
  });

  test('the private key can come from VAPID_PRIVATE_KEY_FILE', () => {
    const env = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY_FILE: file('vapid-private', `${pair.privateKey}\n`) };
    expect(push.vapidFromEnv(env)).toEqual(pair);
  });

  test('neither set: null, so the file (or a new pair) is used', () => {
    expect(push.vapidFromEnv({})).toBeNull();
  });

  test('one without the other stops the start with a clear message', () => {
    expect(() => push.vapidFromEnv({ VAPID_PUBLIC_KEY: pair.publicKey })).toThrow(/VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.*both/);
    expect(() => push.vapidFromEnv({ VAPID_PRIVATE_KEY: pair.privateKey })).toThrow(/both/);
  });
});

describe('kie.ai key', () => {
  afterEach(() => {
    delete process.env.KIEAI_API_KEY;
    delete process.env.KIEAI_API_KEY_FILE;
  });

  test('KIEAI_API_KEY_FILE is used like KIEAI_API_KEY', () => {
    process.env.KIEAI_API_KEY_FILE = file('kie-key', 'key-from-file\n');
    expect(kie.keyOf({ apiKey: 'saved-key' })).toBe('key-from-file');
    expect(kie.publicConfig({}).envKey).toBe(true);
  });

  test('a warning when the environment has a key and one is also saved, and only then', () => {
    expect(kie.duplicateKeyWarning({ apiKey: 'saved-key' })).toBeNull(); // no env key
    process.env.KIEAI_API_KEY = 'env-key';
    expect(kie.duplicateKeyWarning({})).toBeNull(); // nothing saved
    expect(kie.duplicateKeyWarning({ apiKey: 'saved-key' })).toMatch(/also saved in the database.*Settings/);
  });
});

test('print-secrets-env prints the saved files as env lines, and changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(DIR, 'config-'));
  const pair = webpush.generateVAPIDKeys();
  fs.writeFileSync(path.join(dir, '.jwt-secret'), 'a'.repeat(64));
  fs.writeFileSync(path.join(dir, '.vapid.json'), JSON.stringify(pair));
  const before = fs.readdirSync(dir).sort();
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'print-secrets-env.js'), dir], { encoding: 'utf8' });
  expect(out).toContain(`JWT_SECRET=${'a'.repeat(64)}`);
  expect(out).toContain(`VAPID_PUBLIC_KEY=${pair.publicKey}`);
  expect(out).toContain(`VAPID_PRIVATE_KEY=${pair.privateKey}`);
  expect(fs.readdirSync(dir).sort()).toEqual(before);
});
