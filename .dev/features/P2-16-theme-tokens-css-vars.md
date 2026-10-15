# P2-16 — Theme tokens as CSS variables (no visual change)

- **Unit Type:** Implementation (slice 1 of rank 9, "Light theme and a theme picker")
- **Phase:** 2, rank 9
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** index.css / tailwind.config.js units (P2-01, P2-02, P2-17)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #9. Revalidated: the Neon Calabash colours are hard-coded hex values in `web/tailwind.config.js`.

## Scope
- In `tailwind.config.js`, every `ink`, `gray`, `brand`, `lime`, `pink`, `online`, `idle` and `danger` value becomes `'rgb(var(--c-ink-900) / <alpha-value>)'`, so opacity modifiers like `bg-brand/40` and `ring-ink-500/60` keep working.
- `index.css` `:root` defines `--c-*` as space-separated RGB triples. The values equal the current hex exactly.
- Check `theme('colors.brand.DEFAULT')` in `index.css` (`accent-color`, `::selection`, `:focus-visible`, scrollbar) and make sure it still compiles to a valid colour. If Tailwind leaves `<alpha-value>` in place, use `rgb(var(--c-brand))` directly.
- `Gourd.jsx` keeps its hex logo colours (brand art, not theme).

## Acceptance criteria
- [ ] Screenshots of login, chat, settings and voice before and after are pixel-identical, or differ only from anti-aliasing.
- [ ] Grep the built CSS: no `<alpha-value>` literal survives.
- [ ] Changing `--c-brand` in devtools recolours buttons live (proves the indirection works).

## Expected Areas of Change
`web/tailwind.config.js`, `web/src/index.css`.

## Working Set / Blast Radius
2 files, but every coloured pixel depends on them. Screenshot comparison is the gate.
