# P2-19 — Custom server emoji (Container)

- **Unit Type:** Container
- **Phase:** 2, rank 11
- **State:** PLANNED
- **Effort:** M (total)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #11

## Children
| ID | Title | State | Depends on | Acceptance (summary) |
|---|---|---|---|---|
| P2-19a | Server: emoji storage + management API | PLANNED | P1-01, P1-04 | Migration `space_emoji(id, space_id FK CASCADE, name UNIQUE per space [a-z0-9_]{2,32}, url, created_by)`. New permission `manage_emoji` (default rank 2). `GET/POST/DELETE /spaces/:s/emoji`. Upload must be an image under 256 KB (reuse the uploads path plus a size check). Cap of 50 per server. `space_updated` broadcast. Tests cover permission, name validation, cap and cascade on server delete. |
| P2-19b | Client: `:name:` rendering, picker tab, reactions | PLANNED | P2-19a, P2-01 (markdown), P2-06/P2-07 (picker) | `:name:` renders as a 22px `<img>` (`alt=":name:"`) only for emoji of the *current* server. The picker gets a "Server" tab. Reactions use the `<:name:id>` token (the server's react op must accept that format and check it exists in the channel's server). A settings panel lets managers upload and delete emoji. |

## Notes
Cross-server emoji use is a non-goal. Animated GIF emoji are allowed, served the way uploads are today.
