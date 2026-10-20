# DisGourd design review: settings and menus (October 2026, round 2)

The first design round ("Shine", `design/UX-REVIEW-2026-10.md`) ran on 2026-10-17. Since then DisGourd has gained a lot: /imagine with two engines and about thirty ComfyUI options, channel categories, roles, moderation (mod log, bans, time-outs, slow mode), custom emoji, channel topics and edit history. Each one added its controls wherever there was room. This round looks at where everything ended up and proposes a home for each setting.

**How it was checked.** The sandbox server only (`app-sandbox` on :3005, the web dev server on :5174, sandbox DB). I signed in as `sandy` (site admin, owner of both servers). Desktop at 1024×768, phone at 375×812, dark and light themes. I measured scroll heights and counted controls with small scripts in the page. Screenshots are in `shots/`. Voice was joined, but the browser pane blocks the microphone, so the voice panel was only seen in its "no microphone" state.

## Summary

Each screen on its own is tidy, and the earlier round's work holds up well: the theme, the empty states, the touch targets and the tabbed Settings. The trouble is **where things are**:

1. **Image generation is a 2,300 px form** (3,100 px with Advanced open) with 44 controls and one Save button at the very bottom. ComfyUI connection, model files, quality tuning, kie.ai billing, server limits, the 18+ policy and a test generator are all on one page. It is the single biggest source of the "cluttered" feeling.
2. **The Settings window changes height and re-centres for every section.** The section list moves under your pointer, so the next click can land on the wrong section; in the review a click by position missed the list entirely after a section change.
3. **Server settings are spread over eleven menu items**, each opening its own small window: rename, icon, emoji, image generation, roles, mod log, bans, and up to three icon actions. There is no single "Server settings" place, and the menu mixes everyday actions (Invite, Create channel) with admin ones.
4. **Some settings sit in the wrong group.** "Link previews" is under "Registration & access". The daily /imagine limit for servers is set in two places that point at each other. Slow mode and 18+ are at the bottom of the channel's permissions form.
5. **Hidden or risky entry points.** Settings opens only by clicking your *name*; your status opens by clicking your *avatar*; the only icon in the footer is **Sign out**, one click with no confirmation.
6. **Two real bugs:** generated images overflow narrow chat columns and phones (a horizontal scrollbar, and the picture is cut off), and the member menu ignores Escape and clicks outside it.

None of this needs server changes, apart from two optional extras (leave server, change password) that are listed as discovered work.

---

## 1. What is where today

| Entry point | What it opens | What's inside |
|---|---|---|
| Click your **name** in the footer | Settings window | Profile (avatar only) · Voice & audio · Appearance (theme) · Notifications (desktop level, push, message text, message sounds) · *Site admin:* Registration & access (sign-up mode, site admins, **link previews**) · Image generation (everything) |
| Click your **avatar** in the footer | Status menu | Online / Idle / DND / Invisible, custom status |
| **Sign-out** icon in the footer | Signs out at once | — |
| **Server name** ▾ | A menu of up to 14 items | Invite people · Create channel · Create category · Rename server · Upload/Change icon · Reposition icon · Remove icon · Server emoji · Image generation · Roles · Moderation log · Bans · Delete server. Each opens its own window. |
| Channel **gear** | "#channel settings" | Category + Move up/down · Topic · View/Post per role · 18+ · Slow mode · Delete channel |
| Click a **member** | A small menu | Message · Roles… · Remove from server · Time out… · Ban… |

## 2. Findings

Sizes: **S** (hours, one or two files), **M** (a day or two, a few files and tests), **L** (several days).

### Settings window

**S1. The window jumps between sections. M.** The panel is vertically centred and its height follows its content: Appearance is about 220 px tall and Voice & audio about 510 px. Switching sections moves the section list by up to 120 px, so a second click lands on a different section (`shots/02-settings-audio-jump.jpg`: right after clicking Voice & audio, the pointer sits over Profile, because the list moved up under it). *Fix:* a fixed-size window (about 760×min(680 px, 85vh)) with only the right side scrolling.

**S2. Image generation is one long form. L.** 2,266 px to scroll, 44 controls, plus 12 more under Advanced (`05`–`07`). The order is connection → workflow → model → model type → text encoder → VAE → VRAM → upscale model → hires fix → upscale button → Advanced → kie.ai key → kie.ai model → monthly cap → default engine → daily limit → per-server overrides → 18+ policy → **Save** → test generator. Save sits after everything, so a change near the top needs a long scroll to keep. The heading also repeats the section name ("IMAGE GENERATION (SITE ADMIN)"). *Fix:* split it into pages (see the proposal), with a save bar that appears whenever something has changed.

**S3. Link previews is filed under "Registration & access". S.** It is an instance-wide content feature, not an access rule (`04`). *Fix:* move it to a "General" site-admin page.

**S4. Profile is nearly empty. S.** Avatar and email only (`01`). Your status, the most "you" setting, lives in a different menu, and there is nowhere to sign out from inside Settings. *Fix:* call the page "My account": avatar, name and email, status (opens the existing status editor), and Sign out at the bottom.

**S5. On phones Settings is a small centred box with a sideways tab strip. M.** The first sections scroll out of view to the left, and radio labels in Image generation wrap one word per line ("Built- / in", `16`). *Fix:* full screen on phones, a list of sections first, then the section with a back arrow (the pattern people know from phone settings apps).

**S6. Checkboxes for on/off settings, mixed control styles. S.** "Join/leave sounds", "Push notifications", "Hires fix" and others are checkboxes on the far right or left, styled differently from page to page. *Fix:* one setting row (label, help text, a switch on the right) used everywhere.

### Server menu and server settings

**V1. Eleven to fourteen menu items, each a separate window. L.** (`08`) Moderation, roles, emoji, image generation and server identity are all peers of "Invite people". The windows also look different: Roles is a two-pane editor (`10`), Image generation a small form (`09`), and Moderation log and Bans are separate lists. *Fix:* one **Server settings** window with sections (Overview, Emoji, Roles, Image generation, Moderation), and a short menu: Invite people, Create channel, Create category, Server settings.

**V2. The daily image limit points back and forth. S.** The server window says "set in Settings → Image generation" and the site-admin page says "change one in that server's menu → Image generation" (`07`, `09`). It is correct but confusing. *Fix:* the site-admin page shows the default and lists servers that override it; the server page shows "Using the site default (60)" with a single field.

**V3. Role permissions are one flat list of twelve. S.** Channel, member, message, server and image permissions are interleaved (`10`). *Fix:* group them as **Channels** (create, delete), **Members** (invite, remove, ban, time out), **Messages** (delete others', pin), **Server** (edit, emoji, roles), **Images** (generate).

**V4. Delete server sits in the menu. S.** It is fine with the separator, but once there is a Server settings window, it belongs at the bottom of Overview as a "danger zone", which is where people look for it.

### Channel settings

**C1. The order puts the rare things first and the useful ones last. M.** Category and Move up/down come first, then topic, then the permissions table, and 18+ and slow mode at the bottom, below the fold (`11`). Move up/down next to the category picker reads as "move the category". *Fix:* three tabs: **Overview** (topic, category, 18+), **Permissions** (the table), **Moderation** (slow mode), with Delete channel at the bottom of Overview. Reordering stays in the channel list (drag) and the Move buttons get a clearer label ("Move channel up").

### Member menu

**M1. The menu doesn't close on Escape or a click outside. S (bug).** Only clicking the member again closes it (checked twice in the sandbox).

**M2. No context, and three red items in a row. S.** The menu has no header, so it's easy to act on the wrong person, and Remove, Time out and Ban are the same red with no grouping (`12`). *Fix:* a small header (avatar, name, top role, status), then Message and Roles…, a divider, then the moderation actions. Time out uses the amber "idle" colour (it's reversible); Remove and Ban stay red.

### Footer and voice

**F1. Settings has no visible button; Sign out does. S.** The footer has avatar (status), name (settings) and a sign-out icon. People look for a gear. *Fix:* replace the sign-out icon with a **gear** (Settings). Sign out moves to Settings › My account and to the bottom of the status menu.

**F2. The voice panel is busy and its warning is long. S.** (`13`) "Voice connected" in amber, a pink Leave, three icon buttons, a full-width "Share app audio" and a five-line microphone warning. *Fix:* keep the controls and shorten the warning to one line with a "Why?" link that opens Voice & audio settings.

### Visual and consistency

**A1. Dialog headers differ. S.** Some close with the word "Close", the Settings title repeats in each section's heading, and "— Smoke Test" is appended inconsistently. *Fix:* one header style (title, optional subtitle for the server name, an × icon button) through `Modal`.

**A2. Sounds are plain sine beeps. M (assets).** All chimes (join, leave, mention, message, speaker test) are synthesized sine tones in `sounds.js`. They work, but they sound like a test signal, not like a product. *Fix:* a small designed sound set (kie.ai sound effects), five files of about 10 KB each, with the synth kept as a fallback.

### Bugs found along the way

**B1. Generated images overflow narrow columns. S.** The image is capped at `max-w-md` (448 px) but not at the column width. At 1024 px with both sidebars open, the message list scrolls sideways (524 px of content in 478 px). On a phone the picture is cut off at the right edge (`15`). *Fix:* add `max-w-full` alongside the cap.

**B2. The member menu stays open.** See M1.

### Not a design problem, but noticed (recorded, not planned)

- Members can't **leave a server** themselves; there's no route or menu item.
- There's no **change password** for a signed-in user.
- Channels can't be **renamed** after creation.
- These need server routes, so they're feature work, not part of this round.

---

## 3. Proposed information architecture

The rule: **a setting lives where its effect lives.** Things about you go in your Settings. Things about one server go in Server settings. Things about one channel go in that channel's settings. Things about the whole DisGourd install go in Site admin, which only site admins see.

### Your settings (gear in the footer)

```
YOUR ACCOUNT
  My account        avatar · name and email · status · Sign out
  Voice & video     microphone · speaker · tests · push-to-talk · join/leave sounds
  Notifications     desktop level · push when closed · message text · sounds
  Appearance        theme
SITE ADMIN          (only for site admins)
  General           who can sign up · site admins · link previews
  Image generation  overview and the five pages below
```

### Site admin › Image generation (the big split)

The one 2,300 px form becomes six short pages, each reachable from the side list (indented under "Image generation"). They all share the same unsaved-changes bar, so nothing needs a new server route.

| Page | What's on it | Today's controls that move there |
|---|---|---|
| **Overview** | Status cards: "ComfyUI: connected, Flux dev" and "kie.ai: key OK, 12 of 100 credits this month". Default engine. Images per person per day, the list of servers that override it. The 18+ policy. | Default engine, daily limit, server overrides, unfiltered 18+ |
| **ComfyUI** | Address and Test connection. Workflow (built-in or your own). Model, model type, text encoder, VAE. Graphics card memory. | Connection through VRAM |
| **Quality** | Hires fix, upscale model, Upscale button mode, face detailer (strength, passes, detector), and an **Advanced** fold for sampler, scheduler, CFG, steps and negative prompt. | Upscale, hires, detailer, Advanced |
| **Variations** | Loops, Subtle and Strong strength, with the explanation. | Variations block from Advanced |
| **kie.ai** | API key status and Test key. Model. Monthly credit cap. | kie.ai block |
| **Try it** | Generate a test image with the saved settings. | Test generator |

### Server settings (one window, from the server menu)

```
Server menu:  Invite people · Create channel · Create category · ── · Server settings
                                                                       (only if you can manage something)
Server settings window:
  Overview          name · icon (upload, reposition, remove) · danger zone: Delete server (owner)
  Emoji             (today's Server emoji window)
  Roles             (today's Roles window; permissions grouped)
  Image generation  allow /imagine here · images per day (or "site default: 60")
  Moderation        Moderation log | Bans  (two tabs)
```

Each section shows only when you have its permission, exactly as the menu items do today.

### Channel settings

```
Overview     topic · category · 18+ · danger zone: Delete channel
Permissions  view / post per role
Moderation   slow mode
```

### Member menu

```
[avatar] bob · Mods · online
Message
Roles…
──
Time out…            (amber)
Remove from server   (red)
Ban…                 (red)
```

### One settings kit, used everywhere

To make all of this look like one product, the first build unit adds a small kit used by every settings window:

- `SettingsLayout`: fixed size; a side list on desktop; a list → page drill-down on phones; group labels; an indented sub-list.
- `SettingRow`: label, help text and a control on the right (switch, select, number).
- `Switch`: an accessible toggle (`role="switch"`), replacing checkboxes for on/off settings.
- `SaveBar`: "You have unsaved changes · Reset · Save", sticky at the bottom, shown only when something changed. It's used where changes are risky or shared (site admin, server, channel). Personal settings keep applying instantly, as today.

## 4. Generated assets (kie.ai)

The owner has approved kie.ai spend for this round. What's worth making, and what isn't:

| Asset | For | Plan |
|---|---|---|
| **UI sound set** (5 sounds) | Join, leave, someone joined, mention/DM, message; speaker test reuses "join" | kie.ai's sound-effects generation (the "Generate sounds" operation of its Suno API), trimmed and encoded to Ogg/Opus, about 5–15 KB each, in `web/public/sounds/`. The synth stays as a fallback if a file fails to load. Played through the same output device as today. |
| **"Not set up yet" art** for Image generation › Overview | Shown when no engine is on: a flat gourd at an easel | One nano-banana image, then redrawn as inline SVG in the `EmptyState` style (under 5 KB), the same way as the empty states in the first round. |
| Music, video | — | Not proposed. A chat app has no natural place for music, and a video would weigh hundreds of KB for a decorative moment. Animated SVG covers any motion we need. |

## 5. Suggested passes (one packet and one PR each)

| # | Packet | What | Size |
|---|---|---|---|
| 1 | P5-01 | Quick fixes: image overflow (B1), member menu closes on Escape or a click outside (M1) | S |
| 2 | P5-02 | Settings kit and your settings: fixed-size window, phone drill-down, switches, My account, gear in the footer, sign out moved (S1, S4, S5, S6, F1, A1) | M |
| 3 | P5-03 | Site admin: General page and Image generation split into six pages with the save bar (S2, S3, V2 site side) | L |
| 4 | P5-04 | Server settings window and a short server menu; grouped role permissions (V1, V2 server side, V3, V4) | L |
| 5 | P5-05 | Channel settings tabs and the member menu header and grouping (C1, M2) | M |
| 6 | P5-06 | Sound set and the image-generation art (A2, kie.ai), plus the shorter voice warning (F2) | M |

## 6. Decisions for the owner

1. **The settings map above.** Is this the right home for each setting?
2. **Site admin inside your Settings** (a separate group, as today) or a **separate "Site admin" window**? I recommend keeping it inside Settings: fewer places to look, and only admins see it.
3. **Footer:** replace the sign-out icon with a Settings gear, and move Sign out into Settings and the status menu?
4. **Save model:** a save bar for site-admin, server and channel settings, with personal settings applying instantly?
5. **Sounds:** replace the sine beeps with a designed set, keeping the synth only as a fallback?
