// Registration codes that are easy to read aloud and type on a phone.
// New codes look like "K7MPQ-X3HRT": capitals and digits only, without the
// lookalikes 0/O, 1/I/L. Matching ignores case, spaces and dashes, so a phone
// keyboard that capitalises, lowercases or splits the code can't break it.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 symbols
const GROUP = 5;

function newRegCode() {
  let s = '';
  for (let i = 0; i < GROUP * 2; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, GROUP)}-${s.slice(GROUP)}`;
}

// The form a code is compared in: no whitespace or dashes, upper case.
function normalizeRegCode(code) {
  return typeof code === 'string' ? code.replace(/[\s-]+/g, '').toUpperCase() : '';
}

module.exports = { newRegCode, normalizeRegCode, REG_CODE_ALPHABET: ALPHABET };
