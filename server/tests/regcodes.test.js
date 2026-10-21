// Registration codes that survive a phone keyboard (auth/regCodes.js).
const { newRegCode, normalizeRegCode, REG_CODE_ALPHABET } = require('../auth/regCodes');

test('new codes use only easy-to-read characters, in two groups of five', () => {
  expect(REG_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = newRegCode();
    expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    seen.add(c);
  }
  expect(seen.size).toBe(200);
});

test('normalizing ignores case, spaces and dashes', () => {
  expect(normalizeRegCode(' k7mpq x3hrt ')).toBe('K7MPQX3HRT');
  expect(normalizeRegCode('K7MPQ-X3HRT')).toBe('K7MPQX3HRT');
  expect(normalizeRegCode(null)).toBe('');
});
