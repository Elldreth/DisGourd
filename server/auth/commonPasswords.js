// Passwords too easy to guess (P11-08), checked at sign-up and on a password
// change. Passwords are already at least 8 characters, so this lists the
// well-known 8+ character ones from public breach lists, plus patterns: one
// character repeated, a run like 12345678 or abcdefgh, a common word with
// digits after it, and the username inside the password.
//
//   passwordProblem(password, username) -> an error message, or null

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '0123456789', '123123123', '11111111', '00000000', '87654321',
  '12341234', '11223344', '12344321', '112233445566', '147258369', '123654789', '159753456', '123456789a',
  '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx', '1qaz2wsx3edc', 'q1w2e3r4', 'q1w2e3r4t5', 'zaq12wsx',
  '12qwaszx', '1234qwer', 'qwer1234', '123qweasd', 'qweasdzxc', 'qazwsxedc', 'qwertyuiop', 'asdfghjkl',
  'zxcvbnm1', 'zxcvbnm123', 'asdfasdf', 'qwerasdf', 'asdf1234', '1234asdf', 'abcd1234', '1234abcd',
  'abc12345', 'abc123456', 'a1234567', 'a12345678', 'aa123456', 'aa12345678', 'aaaa1111', 'abcdefg1',
  'iloveyou', 'iloveyou1', 'iloveyou2', 'iloveu123', 'sunshine', 'sunshine1', 'princess', 'princess1',
  'football', 'football1', 'baseball', 'baseball1', 'basketball', 'superman', 'batman123', 'starwars',
  'whatever', 'trustno1', 'michelle', 'jennifer', 'jordan23', 'computer', 'internet', 'liverpool',
  'chelsea1', 'arsenal1', 'mustang1', 'shadow12', 'master12', 'killer12', 'charlie1', 'michael1',
  'pokemon1', 'minecraft', 'blink182', 'midnight', 'butterfly', 'chocolate', 'elephant', 'marlboro',
  'changeme', 'changeme1', 'letmein1', 'letmein123', 'welcome1', 'welcome12', 'welcome123', 'administrator',
  'admin123', 'admin1234', 'password', 'password1', 'password12', 'password123', 'password1234', 'password!',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'p@ssword1', 'pa$$w0rd', 'passport', 'qwerty12', 'qwerty123',
  'qwerty1234', 'qwertyui', 'loveyou1', 'lovelove', 'hello123', 'hellohello', 'freedom1', 'secret12',
  'secret123', 'samsung1', 'google123', 'discord1', 'discord123', 'disgourd', 'gourd123',
]);

// A word people pad with digits or a "!": password2024, qwerty99!, letmein7.
const PADDED_WORD = /^(password|passw0rd|p@ssw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|football|baseball|sunshine|princess|master|shadow|summer|winter|spring|autumn|discord|disgourd|gourd|changeme|secret|hello|login)[\d!.@#$]*$/i;

// Every character the same, or each one step up or down from the last
// (12345678, abcdefgh, 98765432).
function trivial(pw) {
  if (/^(.)\1+$/.test(pw)) return true;
  const codes = [...pw].map((c) => c.charCodeAt(0));
  const steps = new Set(codes.slice(1).map((c, i) => c - codes[i]));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

function passwordProblem(password, username) {
  const pw = String(password || '');
  const lower = pw.toLowerCase();
  const name = String(username || '').toLowerCase();
  if (COMMON.has(lower) || PADDED_WORD.test(lower) || trivial(lower) || (name.length >= 3 && lower.includes(name))) {
    return 'That password is too easy to guess';
  }
  return null;
}

module.exports = { passwordProblem, COMMON };
