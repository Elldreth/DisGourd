# P2-20 — `/imagine` and AI media in chat via kie.ai (Container)

- **Unit Type:** Container
- **Phase:** 2, rank 12
- **State:** PLANNED
- **Effort:** M (total; probably L once quotas and admin UI are counted)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #12 and its "/imagine integration" section

## Children
| ID | Title | State | Depends on | Acceptance (summary) |
|---|---|---|---|---|
| P2-20a | System/bot user + server-side posting and attachment updates | PLANNED | P1-01, P1-05 | Migration `users.is_bot INTEGER DEFAULT 0`. A bot user is created at boot with no password login possible (login rejects it). Internal `postAsBot(space, channel, content, attachments)` and `updateMessage(id, { content, attachments })` broadcast `message`/`message_update`. **`message_update` gains `attachments`**; the client hook must apply it. The client shows a BOT badge. Tests: the bot can't log in; a bot post goes only to viewers; the update replaces attachments. |
| P2-20b | kie.ai client + quota + `imagine` gateway op | PLANNED | P2-20a | `server/integrations/kie.js` reads `KIEAI_API_KEY` from env only (compose passes it through; never baked into the image). Permission `use_imagine` (default rank 1). Per-user daily quota plus an instance cost cap (`IMAGINE_DAILY_LIMIT`, `IMAGINE_MONTHLY_CAP`), with a `imagine_usage` table. Flow: placeholder bot message "🎨 imagining…", then poll kie.ai (5-minute timeout), then download the result through **P2-11's `safeFetch`** (host-allowlisted to kie.ai CDN domains) into `UPLOADS_DIR`, then `updateMessage`. Prompts are capped at 1,000 characters. Tests mock the kie client. |
| P2-20c | Client `/imagine` slash-command UX | PLANNED | P2-20b | Typing `/imagine prompt` in the Composer sends the `imagine` op and shows the remaining quota. An error frame becomes an inline Composer error. |

## Open questions (FLAG FOR HUMAN — do not invent)
- Which kie.ai model(s) and endpoints, and what do they cost? The plan doesn't specify; the implementer needs the API docs.
- What default quota and cost cap?
- Is NSFW filtering needed, and is it kie.ai-side or local?
- Should it be available in DMs?
