// Shared lists and helpers for the Image generation pages (P5-03, moved from
// ImagineAdmin.jsx unchanged).

export const FAMILIES = [
  { v: 'sd15', label: 'SD 1.5' },
  { v: 'sdxl', label: 'SDXL (incl. Illustrious, Pony)' },
  { v: 'flux', label: 'Flux' },
];
// A model in separate parts (P3-24): a diffusion model plus text encoder(s) and VAE.
export const SPLIT_FAMILIES = [
  { v: 'flux', label: 'Flux' },
  { v: 'zimage', label: 'Z-Image Turbo' },
  { v: 'anima', label: 'Anima' },
];
// Each model type's tuned defaults (match the server's FAMILIES), shown as
// "Default (…)" in the Advanced settings (P3-31).
export const TYPE_DEFAULTS = {
  sd15: { sampler: 'dpmpp_2m', scheduler: 'karras', cfg: 7, steps: { draft: 16, standard: 26, high: 34 } },
  sdxl: { sampler: 'dpmpp_2m', scheduler: 'karras', cfg: 6, steps: { draft: 18, standard: 28, high: 36 } },
  flux: { sampler: 'euler', scheduler: 'simple', cfg: 1, steps: { draft: 12, standard: 20, high: 28 } },
  zimage: { sampler: 'res_multistep', scheduler: 'simple', cfg: 1, steps: { draft: 6, standard: 8, high: 10 } },
  anima: { sampler: 'er_sde', scheduler: 'simple', cfg: 4, steps: { draft: 20, standard: 30, high: 40 } },
};
export const QUALITY_NAMES = { draft: 'Draft', standard: 'Standard', high: 'High' };
// A number field's value for the API: blank is null.
export const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// Custom workflow placeholders (P3-34), shown as help next to the boxes.
export const PLACEHOLDER_HELP = [
  ['{{prompt}}', 'the prompt (required)'],
  ['{{negative}}', 'the negative prompt, with the safety words outside 18+ channels'],
  ['{{seed}}', 'a new random seed each time'],
  ['{{width}} / {{height}}', 'from Shape, Quality and the VRAM tier'],
  ['{{steps}}', 'by Quality (Advanced steps, or the model type’s defaults)'],
  ['{{quality}}', 'draft, standard or high'],
];
export const UPSCALE_PLACEHOLDER_HELP = [
  ['{{image}}', 'the picture to upscale, for a LoadImage node (required)'],
  ['{{scale}}', 'how much to enlarge it (2, or less to stay within 4096 px)'],
  ['{{prompt}}, {{negative}}, {{seed}}', 'as above'],
];
export const IMG2IMG_PLACEHOLDER_HELP = [
  ['{{image}}', 'the picture to start from, for a LoadImage node (required)'],
  ['{{denoise}}', 'how much to repaint: the Subtle / Medium / Strong strength'],
  ['{{prompt}}, {{negative}}, {{seed}}, {{width}}, {{height}}, {{steps}}, {{quality}}', 'as for the main workflow'],
];

// The model <select> value: kind and file name (the same name can be in both lists).
export const modelKey = (kind, name) => (name ? `${kind}:${name}` : '');
export const TIERS = [
  { v: 'low', label: 'Low', hint: 'up to ~8 GB · about 1 megapixel' },
  { v: 'medium', label: 'Medium', hint: '12–16 GB · about 1.5 megapixels' },
  { v: 'high', label: 'High', hint: '24 GB or more · up to about 2.4 megapixels' },
];
export const SHAPES = [
  { v: 'square', label: 'Square' },
  { v: 'portrait', label: 'Portrait' },
  { v: 'landscape', label: 'Landscape' },
  { v: 'wide', label: 'Wide' },
];
export const QUALITIES = [
  { v: 'draft', label: 'Draft' },
  { v: 'standard', label: 'Standard' },
  { v: 'high', label: 'High' },
];
export const heading = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400';
// A card around a group of settings on a page.
export const card = 'space-y-3 rounded-xl bg-ink-900/60 p-4';

// A kie.ai price for display: the last real one, or an estimate (P2-20c).
export function priceLabel(p) {
  if (!p) return 'price unknown until first use';
  return p.estimate ? `≈ ${p.credits} credits (est.)` : `${p.credits} credits`;
}
