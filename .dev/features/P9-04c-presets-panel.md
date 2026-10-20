# P9-04c — Style presets: the /imagine panel and messages

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** PLANNED (READY once P9-04b merges)
- **Effort:** S–M
- **Depends on:** P9-04a, P9-04b

## Scope
- **The panel:** a **Style** chip row (after Quality) when the chosen engine is ComfyUI and there are 2+ styles. The default is preselected; the last choice is remembered per person on this device. It's hidden for kie.ai and when there's only one style. "Start from a picture" uses the chosen style too.
- **The bot's message:** it names the style when there's more than one: "🎨 sandy imagined (Anime): …".
- **Again / Variations / Upscale** keep the image's style. That's server-side from P9-04a; the app only shows it.

## Acceptance criteria
- [ ] Web: the row's visibility rules, the default and remembered choice, `preset` sent with the request, the message text.
- [ ] All suites pass; `vite build` is clean.
- [ ] Live: pick Anime, then Photoreal; each image says its style, and a Variation keeps it.
