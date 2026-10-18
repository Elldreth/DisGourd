# P3-25c — Drag and drop channels and categories

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** PLANNED (READY once P3-25b merges)
- **Effort:** S–M
- **Depends on:** P3-25b

## Scope
- **Managers can drag** a channel (within a category, to another category, or to the uncategorized top) and drag a category heading to reorder categories.
- **During the drag,** a drop line shows where it will land, and an empty or collapsed category accepts drops on its heading.
- **On drop,** one `PUT /layout` with the new order. The list updates immediately and is put back if the server refuses.
- **Pointer-based**, so a mouse or pen works. On touch screens dragging starts only from a small handle shown in an "Arrange" mode; otherwise phones use b's menus. Esc cancels a drag.

## Acceptance criteria
- [ ] Web: the layout sent for dropping within a category, across categories, and to the uncategorized area; dragging a category; Esc cancels; non-managers can't drag; a refusal puts the list back.
- [ ] Sandbox: drag a channel into another category and reorder categories; a second user sees it.
