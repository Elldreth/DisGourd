// Prompts /imagine refuses in every channel, whatever the engine (P2-20a):
// sexual content involving minors. A word-list check catches the plain
// phrasings, not every one; the engines' own filters and the instance owner's
// responsibility still apply.
const SEXUAL = [
  'nude', 'nudes', 'naked', 'nsfw', 'sex', 'sexy', 'sexual', 'porn', 'porno', 'pornographic', 'explicit', 'erotic',
  'topless', 'bottomless', 'lingerie', 'underwear', 'genital', 'genitals', 'breasts', 'boobs', 'undressed',
  'xxx', 'hentai', 'fetish', 'seductive', 'lewd', 'orgasm', 'aroused', 'bikini',
];
const MINOR = [
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'underage', 'teen', 'teens', 'teenage', 'teenager',
  'preteen', 'toddler', 'infant', 'baby', 'babies', 'schoolgirl', 'schoolboy', 'loli', 'lolita', 'shota',
  'juvenile', 'prepubescent', 'pubescent',
];
// "girl" or "young" alone is common for adults; these pairs aren't.
const MINOR_PHRASES = /\b(?:little|young|small|tiny)\s+(?:girls?|boys?)\b|\b(?:girls?|boys?)\s+under\s+18\b/i;
// "12 year old", "12yo", "12-year-old", "aged 12" (under 18).
const AGE = /\b(?:[1-9]|1[0-7])\s*(?:-?\s*years?\s*-?\s*old|yo|y\/o|yrs?)\b|\baged?\s+(?:[1-9]|1[0-7])\b/i;

const words = (text) => new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9/ ]+/g, ' ').split(/\s+/).filter(Boolean));

// null when the prompt is fine, else a short reason.
function refusedReason(prompt) {
  const w = words(prompt);
  const sexual = SEXUAL.some((s) => w.has(s));
  if (!sexual) return null;
  if (MINOR.some((m) => w.has(m)) || MINOR_PHRASES.test(prompt) || AGE.test(prompt)) return 'Sexual content involving minors is never allowed';
  return null;
}

module.exports = { refusedReason };
