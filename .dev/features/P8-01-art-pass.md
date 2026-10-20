# P8-01 — Art pass: mascot poses, sign-in art, ready-made server icons, share image

- **Unit Type:** Implementation
- **Phase:** 8 (brand art)
- **State:** COMPLETE (merged #175)
- **Effort:** M
- **Depends on:** nothing (main after #173)
- **Serialize with:** anything editing `AuthShell.jsx`, `EmptyState.jsx`, `CreateServerDialog.jsx`, `server-settings/OverviewSection.jsx`, `server/static.js`
- **Requirement Source:** `design/IMPROVEMENT-PLAN.md` Phase 4, "Assets to generate": login hero art, 6–8 mascot poses, 12 default server-icon glyphs, an OG share image. The owner approved the art pass and kie.ai spend (2026-10-20, relayed by the coordinating session).

## Scope
- **Mascot:** seven poses of the gourd mark: waving, sleeping, headphones, magnifier, confused, party, shushing. There is no face (matching the flat, faceless empty-state style): the speech-bubble belly shows the mood as a lime symbol, plus a small prop. They're drawn from one data file, so the React component and the static offline page match. They're used on:
  - the sign-in/register card (waving) and the setup wizard's last step (party);
  - the offline page (sleeping);
  - the search "nothing found" scene (magnifier);
  - the quick switcher's "no matches" (confused);
  - the timed-out notice (shushing).

  The headphones pose is in the set but not placed yet.
- **Sign-in art:** a flat vine of speech-bubble gourds, from the theme colours. Wide screens get a garland across the top; phones get a low vine with gourds standing on it below the card. It replaces the faint corner watermark.
- **Ready-made server icons:** 12 glyphs (gourd, controller, music, book, paw, leaf, code, art, rocket, coffee, film, star), white on coloured tiles.
  - You pick one in the Create server dialog ("No picture? Pick an icon") or in Server settings › Overview ("Or pick a ready-made icon").
  - It's drawn to a 256 px PNG in the browser and uploaded like any icon, so the server and the rail need nothing new.
- **Share image:** a 1200×630 card (the waving mascot and the DisGourd name) at `/og-image.png`, plus `og:*`, `twitter:card` and a description in `index.html`. The server puts its own address into the `og:image` link when it serves `index.html`, because other apps need an absolute URL. Odd Host headers fall back to a relative link.

## Acceptance criteria
- [x] AC-1: every pose renders from theme colours only, works in one colour, and stays under 5,000 characters of markup.
- [x] AC-2: the sign-in art never overlaps the card at 1024×768 or 375×812, and follows the light theme.
- [x] AC-3: picking a ready-made icon sets the server's icon (create and Overview), and the rail shows it.
- [x] AC-4: `index.html` served by the server has an absolute `og:image` built from Host (or X-Forwarded-Host/-Proto), and never echoes a malformed Host.
- [x] AC-5: every asset is small: the share image ≤ 20 KB, the poses and art as inline SVG, references as small JPEGs.

## Starting Baseline
Revision: `ef006a8` (main after #173). Web suite before: 98 files / 761 tests; server 46 suites.

## Implementation notes
- **Mascot:**
  - `web/src/mascotParts.js` holds the mark's paths (`Gourd.jsx` now imports them from there) and the poses as data, plus `mascotSvg()` for static pages.
  - `components/Mascot.jsx` renders a pose; `MascotParts` draws one inside another SVG (the search scene).
- **Sign-in art:** `components/LoginArt.jsx`. `AuthShell` shows it with the waving mascot and takes a `pose` prop; its wrapper is now a `<main>`, which fixed two moderate axe findings on the sign-in screen (no main landmark).
- **Server icons:**
  - `web/src/serverGlyphs.js` holds the glyphs, tile markup and `glyphToPng()`, and `components/GlyphPicker.jsx` is the picker.
  - `useSpaces.setServerGlyphIcon(file)` uploads the PNG once and uses it as its own original (no crop). The create flow reuses its `{ original, blob, crop }` icon object.
- **Share image:** rendered with headless Edge from HTML (fonts from Google Fonts), quantised to 48 colours: 13.2 KB. `server/static.js` gained `originFor(req)` and `withOrigin(html, req)`, and `http/handler.js` passes `req`.
- **kie.ai references:** 6 images with nano-banana, 24 credits, in `design/art-pass-2026-10/refs/` as 640 px JPEGs, each with its prompt (`.json`). Nothing generated ships; everything shipped is redrawn as SVG, or rendered from our own SVG/HTML.
- **Layout fixes found in the sandbox:**
  - At 1024 px, two garland gourds touched the card's edges. I moved them to the outer thirds; there are now 0 overlaps by bounding box.
  - On phones, a corner vine ran under the card and looked cramped. I replaced it with a vine along the bottom, which starts 27 px below the card.

## Owner feedback (2026-10-20)
- **Sleeping:** drawn upright now; the Zs in the belly say "asleep" on their own.
- **Waving:** the arm on the left is gone (it didn't read as an arm). The leaf now does the waving, tipped up with two motion marks beside it.
- The sign-in card, offline page, share image and pose sheet were re-rendered with both changes, and a test checks the wave has no arm.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `ArtPass.test.jsx` + render | All seven poses: theme variables only, no literal colours, under the size limit; `color` gives one colour. Sheet in dark, light and black-and-white: `design/art-pass-2026-10/shots/mascot-poses-sheet.png` |
| AC-2 | Verified | Sandbox (this branch's server on :3008, on a copy of the sandbox DB) | Desktop: 0 garland gourds overlap the card (`login-desktop-dark.jpg`, `login-desktop-light.jpg`). Phone: the art starts at y=662 and the card ends at 635 (`login-phone-dark.jpg`) |
| AC-3 | Verified | Sandbox + test | Created "Art Check" with the rocket icon: the rail shows `/uploads/…/rocket.png` (`create-server-rocket.jpg`). Server settings › Overview → music: the rail and Overview switched to `music.png` (`server-settings-glyphs.jpg`). The test covers 12 tiles and the PNG hand-off |
| AC-4 | Verified | `server/tests/shareMeta.test.js` + sandbox | Host, proxy headers, a hostile Host (relative link, no script), IPv6. Sandbox: `og:image` = `http://localhost:3008/og-image.png`, and the image returns 200 |
| AC-5 | Verified | Files | `og-image.png` 13.2 KB; the poses and art are inline SVG; references 152 KB together |
| Accessibility | Verified | axe-core 4.10.2 | Server settings › Overview with the picker: no violations. Sign-in screen: no violations after the `<main>` change |
| Suites | Verified | Vitest, Jest, Vite | Web 99 files / 767 tests; server 47 suites / 421 tests; `vite build` clean |

## Not checked
- A real link unfurl in Discord or Slack: that needs a public address.
- The setup wizard's party pose and the timed-out shush pose were checked in tests, not seen in the sandbox.
