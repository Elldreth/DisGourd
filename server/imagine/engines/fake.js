// The fake engine (P2-20a): a solid-colour PNG after a short wait, for tests
// and the sandbox only — it exists when IMAGINE_FAKE_ENGINE=1. Prompt markers
// steer it: "[fail]" fails, "[slow]" waits longer, "[hang]" waits until the
// job is aborted (the runner's timeout).
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// A width × height PNG filled with [r, g, b].
function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// A colour from the prompt, so different prompts look different.
function colorFor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff];
}
const SIZES = { square: [64, 64], portrait: [48, 72], landscape: [72, 48], wide: [96, 54] };

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = ms === Infinity ? null : setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('Stopped'), { code: 'ABORTED' }));
    }, { once: true });
  });
}

module.exports = {
  id: 'fake',
  name: 'Test engine',
  available: () => process.env.IMAGINE_FAKE_ENGINE === '1',
  validateConfig: (input) => ({ enabled: !!(input && input.enabled) }),
  publicConfig: (cfg) => ({ enabled: !!(cfg && cfg.enabled) }),
  costOf: () => 0,
  async generate(request, cfg, { signal } = {}) {
    const base = parseInt(process.env.IMAGINE_FAKE_DELAY_MS, 10);
    const delay = Number.isFinite(base) ? base : 300;
    const p = request.prompt;
    await wait(p.includes('[hang]') ? Infinity : p.includes('[slow]') ? delay * 5 : delay, signal);
    if (p.includes('[fail]')) throw Object.assign(new Error('The test engine failed on purpose'), { code: 'ENGINE' });
    const [w, h] = SIZES[request.shape] || SIZES.square;
    return { model: 'fake', images: [{ buffer: solidPng(w, h, colorFor(p)), contentType: 'image/png' }] };
  },
};
