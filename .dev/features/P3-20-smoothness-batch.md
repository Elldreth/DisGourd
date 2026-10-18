# P3-20 — Smoothness batch (Container: a–c)

- **Unit Type:** Container
- **Phase:** 3
- **State:** COMPLETE (a #129, b #130, c #131)
- **Requirement Source:** the user, 2026-10-18: "Start the smoothness polish batch: channel topics, Create a server from the empty screen, the DM new-messages divider, the two accessibility fixes, and Hide preview." Drawn from UX review F7 and the discovered-work notes in P4-03, P2-05, P4-06 and P4-05.

## Children
| ID | Title | Covers | Effort |
|---|---|---|---|
| P3-20a | Channel topics | UX review F7: an optional topic per channel, set in Channel settings, shown in the header (truncated, click to expand) and on the channel's welcome card | M |
| P3-20b | Small fixes | "Create a server" from the no-servers screen (P4-03 note); a new-messages divider in DMs (P2-05 note); offline members dimmed with a muted colour instead of opacity (P4-06 note, axe `color-contrast`); links in messages underlined at rest, not colour only (P4-06 note, axe `link-in-text-block`) | S–M |
| P3-20c | Hide preview | The author (and anyone who may delete others' messages) can remove a link card from a message; everyone's copy drops it live (P4-05 note) | S–M |

Order a → b → c, one PR each, so each is small enough to review.
