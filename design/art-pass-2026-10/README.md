# Art pass (P8-01), 2026-10-20

These are the Phase 4 assets from `design/IMPROVEMENT-PLAN.md`, drawn flat in the Neon Calabash colours.

| Asset | Where it lives | Size |
|---|---|---|
| Mascot, 7 poses (waving, sleeping, headphones, magnifier, confused, party, shushing) | `web/src/mascotParts.js` (data) → `components/Mascot.jsx`; static copy in `web/public/offline.html` | inline SVG, under 5 KB per pose |
| Sign-in art (a garland on wide screens, a ground vine on phones) | `components/LoginArt.jsx` | inline SVG |
| 12 ready-made server icons | `web/src/serverGlyphs.js` → `components/GlyphPicker.jsx` | inline SVG; 256 px PNG when picked |
| Share image, 1200×630 | `web/public/og-image.png` | 13.2 KB |

- `refs/`: the kie.ai references (google/nano-banana, 6 images, 24 credits), each with its prompt in a `.json` file beside it. They're 640 px JPEG copies and not shipped. The shipped art is redrawn as SVG, or rendered from our own SVG/HTML.
- `shots/`: the pose sheet (dark, light and one colour), the glyph sheet, and sandbox screenshots of each asset in place.

**Mascot rules:**
- No face. The speech-bubble belly shows the mood as a lime symbol, and a small prop says the rest.
- Two colours, taken from `--color-brand-logo` and `--color-lime`, so it follows the light theme. It must also read in one colour.
- To add a pose, add an entry to `POSES` in `mascotParts.js`; `ArtPass.test.jsx` checks colours and size for every pose.
