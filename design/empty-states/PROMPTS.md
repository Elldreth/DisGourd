# Empty-state illustration candidates

Generated 2026-10-17 with kie.ai, model `google/nano-banana`, 1:1, two variants per subject. These are references for the hand-drawn SVGs in `web/src/components/EmptyState.jsx`; the PNGs are not shipped.

Shared style suffix:

> Exactly two colours on a solid very dark violet background (#1D1838): violet #9466FF and lime #B8F34A. No gradients, no shading, no outlines, no text, no faces, large simple geometric shapes, generous empty space, centered, minimal and friendly, flat vector, like a logo-system icon.

## empty-channel

Files: `empty-channel-1.png`, `empty-channel-2.png`

Prompt:

> Flat vector spot illustration for an app empty state, 'this channel is empty': a single stylised bottle gourd whose lower bulb is an open speech bubble shape (a lantern-like gourd), unlit, sitting alone, with one small lime leaf on its stem.

## no-dms

Files: `no-dms-1.png`, `no-dms-2.png`

Prompt:

> Flat vector spot illustration for an app empty state, 'no direct messages yet': two stylised bottle gourds facing each other, each with a speech-bubble shaped lower bulb and a small lime leaf, as if about to talk.

## no-server

Files: `no-server-1.png`, `no-server-2.png`

Prompt:

> Flat vector spot illustration for an app empty state, 'no server yet': one stylised bottle gourd with a speech-bubble shaped lower bulb and a lime leaf, sprouting from a small round flower pot, a seedling just planted.

## nothing-found

Files: `nothing-found-1.png`, `nothing-found-2.png`

Prompt:

> Flat vector spot illustration for an app empty state, 'nothing found': one stylised bottle gourd with a speech-bubble shaped lower bulb and a lime leaf, beside a large simple magnifying glass leaning against it.

## What was used

All eight came out on-brand (two flat colours, the speech-bubble gourd). They were used as references, not shipped: `EmptyState.jsx` redraws each scene as inline SVG built from the real logo mark (`Gourd.jsx`), so the art uses the theme's CSS variables and follows the light theme. Scenes: `channel` from empty-channel-1, `dms` from no-dms-1 (with three lime dots between the gourds), `server` from no-server-1 (pot under the gourd), `search` from nothing-found-1 (magnifier beside the gourd). Each shipped SVG is under 6 KB of markup; the PNGs stay here only.

## Run log

- empty-channel-1.png: ok
- empty-channel-2.png: ok
- no-dms-1.png: ok
- no-dms-2.png: ok
- no-server-1.png: ok
- no-server-2.png: ok
- nothing-found-1.png: ok
- nothing-found-2.png: ok
