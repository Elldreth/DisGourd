# P3-26d — Slow mode

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** READY
- **Effort:** S–M
- **Depends on:** P3-26a

## Scope
- **Migration:** `channels.slowmode_seconds INTEGER NOT NULL DEFAULT 0`.
- **Channel settings:** "Slow mode" (Off / 5 s / 30 s / 1 min / 5 min) on text channels, via PATCH `/spaces/:s/channels/:c { slowmode }`; logged; `space_updated`.
- **Gateway:** a post less than N seconds after that person's last post in the channel is refused with `SLOWMODE { retryAfter }`. Exempt: delete_others_messages / edit_server holders and the owner. Threads inherit their parent's setting.
- **channelMeta** carries `slowmode`.
- **The composer:** after sending in a slow-mode channel, it shows "Slow mode: 23 s" and disables Send until the countdown ends; a refusal syncs it.

## Acceptance criteria
- [ ] Server: the setting (managers only), refusal with retryAfter, moderators exempt, threads inherit, logged.
- [ ] Web: the setting in channel settings; the composer countdown.
- [ ] Sandbox: 30 s slow mode; bob posts twice and the second is refused with a countdown; sandy is exempt.
