# P9-04c — Style presets: the /imagine panel and messages

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at f4485e7 (#185 merged)
- **Effort:** S–M
- **Depends on:** P9-04a, P9-04b

## Scope
- **The panel:** a **Style** chip row (after Quality) when the chosen engine is ComfyUI and there are 2+ styles. The default is preselected; the last choice is remembered per person on this device. It's hidden for kie.ai and when there's only one style. "Start from a picture" uses the chosen style too.
- **The bot's message:** it names the style when there's more than one: "🎨 sandy imagined (Anime): …".
- **Again / Variations / Upscale** keep the image's style. That's server-side from P9-04a; the app only shows it.

## As built
- **Server (`imagine/index.js`, `runner.js`):** when there's more than one style, the job carries the style's name, and the finished message names it: "🎨 sandy imagined (Anime): …", "🎲 sandy varied (subtle, Anime): …", "🔍 sandy upscaled (Anime): …". With one style, the text is unchanged. When a deleted style falls back to the default, the message names the one actually used.
- **The panel (`ImaginePanel.jsx`):** `imagineState` passes `styles` and `defaultStyle` from GET /spaces. A **Style** chip row follows Engine when the engine is ComfyUI and there are 2+ styles (`showStyles`).
- **The message box (`Composer.jsx`):** the default is preselected, or the last style picked on this device (`localStorage` `disgourd.imagineStyle`) if it still exists. The key is per device, not per account; a shared browser shares it. `preset` is sent only when the row is shown, and it applies to "Start from a picture" too.
- **Found during the live check and fixed here:** the Variation/Upscale buttons find the bot's finished messages by their text (`imagineResultKind` in `ImagineAgain.jsx`), so "imagined (Anime):" lost its buttons. The patterns now allow the style.

## Acceptance criteria
- [x] Web: the row's visibility rules, the default and remembered choice, `preset` sent with the request, the message text.
- [x] All suites pass; `vite build` is clean.
- [x] Live: pick Anime, then Photoreal; each image says its style, and a Variation keeps it.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Web | `Composer.imagine.test.jsx` (+1): with ComfyUI + kie.ai and three styles (default Photoreal), the row shows Default/Photoreal/Anime with Photoreal pressed, and Enter sends `preset: 'photo'`. Picking Anime sends `preset: 'anime'` and stores it. kie.ai → no row, no `preset`. A new box starts on Anime; if Anime is gone, it starts on the default. One style → no row, no `preset`.<br>`ImagineAgain.test.jsx`: "imagined (Anime):", "varied (subtle, Photo (raw)):" and "upscaled (Anime):" are recognized; "imagined (Anime) a gourd" (no colon) isn't.<br>Server `imagine-comfyui.test.js` (P9-04a chat test, +3 checks): "🎨 **admin** imagined (Anime): a gourd at dusk" (the prefix isn't shown), "🎲 **admin** varied (subtle, Anime): …"; after Anime is deleted, one style is left, so "🎲 **admin** varied (strong): …" |
| All suites | Server 50 files, 444. Web 102 files, 797. `vite build` clean |
| Live (sandbox :3005, the owner's ComfyUI) | Typing /imagine showed Shape, Quality, Engine, **Style (Default, Photoreal, Anime)**, with Default pressed. Draft + Anime → "🎨 sandy imagined (Anime): a ceramic gourd on a wooden table by a window". The next /imagine preselected Anime (remembered); Photoreal → "imagined (Photoreal): …". The first run showed no Variation buttons on the new messages (the fix above); after the rebuild, Subtle variation on the Anime image → "🎲 sandy varied (subtle, Anime): …". ComfyUI history: Hassaku + "anime screencap, …" (denoise 1), Juggernaut + "RAW photo, natural light, …" (1), Hassaku + "anime screencap, …" (0.3) |
