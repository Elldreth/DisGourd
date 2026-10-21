# P10-00 — Design round 3: the Phase 9 screens (Container)

- **Unit Type:** Container (design review + child packets)
- **Phase:** 10 (design)
- **State:** COMPLETE (review merged in #200; the owner agreed with the plan and its recommendations, 2026-10-21)
- **Effort:** L in total (children S–M each)
- **Depends on:** P9-01 … P9-08 (main after #199)
- **Requirement Source:** the owner, relayed 2026-10-20: "I'd like to have the UX/UI Designer have another pass over the application since we've made changes to the ui", with permission to use kie.ai for "any new graphics, video, sound, or otherwise".

## Scope
- A review of every screen Phase 9 added: `design/design-review-p10/REVIEW.md`, with screenshots in `shots/`.
- Eight passes, one packet and one PR each: P10-01 … P10-08 (see the review's section 3).
- Decisions for the owner are listed in the review's section 5. Children marked "depends on decision" stay PLANNED until then.

## Children
| ID | Title | Size | Waits on |
|---|---|---|---|
| P10-01 | Reports: grouped cards, action hierarchy, nav count, quoted dialog, empty state, menu groups, phone deep link | M | decision 3 (count messages or reports) |
| P10-02 | Privacy & safety page; device list order and limit; Log out wording | S–M | decision 2 |
| P10-03 | Blocking polish | M | none |
| P10-04 | Group DMs polish (+ notice contrast fix) | S–M | none |
| P10-05 | Image generation: Styles page and Quality/kie.ai tidy | M–L | decisions 1 and 4 |
| P10-06 | /imagine panel: labelled groups, steady height | S–M | none |
| P10-07 | Small things: transfer button/list, ☰ badge dot, light amber badge | S | none |
| P10-08 | New art and sound (kie.ai references → SVG; two sounds) | S–M | decision 5 (video) only for the optional clip |

## Owner decisions (2026-10-21)
"I agree and have merged the PR with the plan" (relayed by the coordinating session). Read as the review's recommendations:
1. Styles page: yes.
2. Privacy & safety: yes.
3. Report counts: by message.
4. The optional server fields: no recommendation was made, so they stay out, unless the owner asks.
5. Motion: CSS/SVG in the app; no video.

**Build order:** P10-08 first (its poses feed P10-01 and P10-04), then P10-01 … P10-07.

## Serialize
- P10-03 and P10-04 share `MessageList.jsx` and `DmPanel.jsx`.
- P10-01 and P10-03 share the message menu in `MessageList.jsx`.
- P10-08's poses are used by P10-01 (the empty queue) and P10-04 (the group welcome). Either P10-08 goes first, or those two ship with a plain empty state.

## Verification Evidence
| Item | Status | Evidence |
|---|---|---|
| Review walk | Done | Sandbox :3005 (v31) + web :5174; desktop 1280×800, phone 375×812, dark and light; seeded reports, a group and a block with scripts (sandbox users only) |
| Accessibility | Done | axe-core 4.10.2: one serious contrast failure (X2, group notice times); everything else clean |
| kie.ai spend for the review | 0 credits | Nothing was generated for the review itself |

## Discovered Work
- X3 in the review: an empty "Welcome to #general" was seen once on first load of a channel that has messages. It wasn't reproduced. Recorded, not planned.
