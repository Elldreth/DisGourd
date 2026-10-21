# DisGourd design review: the Phase 9 screens (October 2026, round 3)

The last design rounds were the settings round (P5, `design/settings-review-2026-10/`) and the art pass (P8-01). Since then Phase 9 added a lot of new UI (#176–#199):
- message reports and a Reports queue;
- handing a server to a new owner;
- signed-in devices;
- ComfyUI styles;
- kie.ai pictures;
- group DMs;
- blocking;
- new hires and CLIP skip settings.

This round looks at those screens: how they fit with the rest of the app, and what they need to feel finished.

**How it was checked.**
- **Where:** the sandbox server only (`app-sandbox` on :3005, at migration v31), with the web dev server on :5174.
- **Who:** signed in as `sandy`, the site admin and owner of Tx Check.
- **Test data:** small scripts gave it some real content:
  - bob posted four messages, two of them reportable;
  - cara and dee filed three reports (two on the same message);
  - bob started a group, "Gourd Club", with sandy and cara;
  - dee posted three messages and a DM, then sandy blocked dee from the member list.
- **Sizes and themes:** desktop at 1280×800, phone at 375×812, dark and light.
- **Accessibility:** axe-core 4.10.2 on the Reports page, the Report dialog, the group members dialog, My account and a channel with a blocked row.
- **Screenshots:** in `shots/`.
- **Not exercised:** the 🎲 Variation button on a finished kie.ai image (no real kie.ai run), and transfer ownership beyond the dialog.

## Summary

Phase 9 works, and most of it already uses the shared settings kit and theme, so nothing looks foreign. What it lacks is **hierarchy**. Most new screens give every action the same weight and put every new thing on the page that was already there. Five things stand out:

1. **The Reports queue is a wall of equal buttons.** Each report has six same-looking buttons, and on a phone they wrap into three rows. Two reports on the same message show as two separate cards, although handling one closes both.
2. **Each style's settings are in two places.** A style's model, workflow and prompt prefix are edited on the ComfyUI page. Its sampler, scheduler, CFG, steps, hires steps, CLIP skip and negative prompt are on the *Quality* page, behind a second Style picker. You have to know to look in both.
3. **My account is 1,600 px tall.** The device list has no limit (15 rows in the sandbox), "This device" sits third, and Blocked people and Log out are buried below it. There are now three different "Sign out" buttons on one page.
4. **Blocking is quiet where it should be clear, and loud where it should be quiet.**
   - Quiet: the collapsed "3 blocked messages · Show" line is small grey italics tucked under the previous author's group, so it reads as part of bob's messages.
   - Loud: **Block…** is amber in the member menu (the moderators' Time-out colour) but plain in the message menu.
   - Confusing: searching for a blocked person in New message says "No one by that name in your servers".
5. **Group DMs don't yet look like groups.**
   - The group picture is two 23 px avatars, the back one mostly hidden. A group with one other person shows a single small avatar in the corner of its 32 px space.
   - The last-message preview doesn't say who sent it.
   - A new group gets the two-gourd art used for 1-to-1 chats.

**Three bugs and one accessibility failure** turned up (section 2, *Bugs*). One is that **Reports** from the server menu opens Server settings at the section list on a phone, not at Reports.

Everything proposed is app-only, except two optional extras (a "credits used this month" figure for kie.ai, and the date someone was blocked), which need a small server field each.

---

## 1. What's where (the Phase 9 screens)

| Feature | Entry points | Screens |
|---|---|---|
| Reports (P9-01) | Message menu › **Report…**; server menu › **Reports (n)**; amber count on the rail icon | Report dialog (reason chips, note); Server settings › Moderation › **Reports** (Open/Closed, six actions per report) |
| Transfer ownership (P9-02) | Server settings › Overview › danger zone | Transfer dialog (searchable member list, type the name) |
| Signed-in devices (P9-03) | Settings › My account | One row per device, Sign out each; Sign out all other devices |
| Styles (P9-04) | Settings › Image generation › ComfyUI › **Styles**; Quality › Advanced › **Style** | Styles list + "Editing style: X" fields below it; the /imagine panel's Style chips |
| kie.ai pictures (P9-05) | Settings › kie.ai; the /imagine panel's picture row | "Model for pictures"; a paragraph about pictures; Strength chips or "🎲 Variation" |
| Group DMs (P9-06) | New message › **Start a group**; a 1-to-1's header **+**; the group header's **Members** | People picker; Members dialog; group rows; centered notices |
| Blocking (P9-07) | Member menu **Block…**; message menu **Block bob…**; the DM header's ⊘ icon; Settings › My account › Blocked people | Confirm; collapsed rows; the DM bar |
| Hires and CLIP skip (P9-08) | Quality (Hires strength); Quality › Advanced (Hires steps, CLIP skip) | Number fields |

## 2. Findings

Sizes: **S** (hours, one or two files), **M** (a day or two), **L** (several days).

### Reports (moderators)

**R1. Six equal buttons per report. M.** Jump to message, Delete message, Time out…, Ban…, Mark handled and Dismiss are all the same small outlined chip (`shots/01-reports-open.jpg`). On a phone they wrap into three rows per report (`shots/16-phone-reports.jpg`).
- *Fix:* give them a hierarchy.
  - Make the excerpt itself the "jump" link: click the quote or "#general" to open the message.
  - **Mark handled** becomes the one filled button, with **Dismiss** as a quiet text button beside it.
  - Delete message, Time out… and Ban… move into one **Act on bob ▾** menu, in danger colours, ranked as today (buttons you can't use stay hidden).
  - On a phone that fits on one row.

**R2. Several reports on one message show as separate cards. M.** The spam message reported by cara and by dee appears twice, with identical excerpts and buttons. Handling either closes both (by design), so the second card disappears without warning.
- *Fix:* one card per message, with all the reasons on it: "Spam ×2 · reported by cara ("link in profile is sketchy") and dee". The count on the tab, the menu and the rail becomes *messages to look at*, which is what a moderator cares about.
- This can be done in the app: the reports already carry `messageId`. Reports whose message is gone group by excerpt and author.

**R3. Reports has no count in the Server settings list. S.** The rail and the server menu show 3, but inside the window the Moderation › Reports item is plain.
- *Fix:* the same amber count beside the label, and in the phone list.

**R4. The Report dialog doesn't show what you're reporting. S.** It says "Report @bob's message?" but not which one (`shots/02b-report-dialog.jpg`).
- *Fix:* quote the message (two lines, the same quote style as the queue) under the title.
- At 375 px, "Something else" wraps onto its own line; a two-by-two grid of chips fixes that.

**R5. The empty queue is a line of grey text. S.** "No open reports. All quiet." is the moment to reward a moderator.
- *Fix:* the shared empty-state component with a new mascot pose (section 4), plus "Nothing to look at. Nice."

**R6. The message menu has no groups. S.** Reply, React, Copy, Pin, Thread, **Block bob…**, **Report…**, Delete all sit in one run (`shots/02-message-menu.jpg`).
- *Fix:* thin dividers into three groups: everyday actions; then Report… and Block bob…; then Delete.

### Transfer ownership

**T1. Two identical danger buttons. S.** In the danger zone, "Transfer ownership…" and "Delete server" look exactly alike (`shots/08-overview-danger-zone.jpg`). Transferring is serious but undoable by the new owner; deleting isn't undoable at all.
- *Fix:* Transfer becomes an outlined neutral button, and Delete keeps the danger fill.

**T2. The member list in the Transfer dialog is bare. S.** It shows a radio and a name only (`shots/08b-transfer-dialog.jpg`).
- *Fix:* add each member's avatar and top role ("Mods", "Admin"). The person you'd usually pick is the one with a role.

### My account, devices and blocked people

**A1. My account has become a long scroll. M.** 1,627 px of content in a 625 px panel: profile, status, password, 15 devices, Sign out all others, Blocked people, then Log out (`shots/07-my-account-bottom.jpg`).
- *Fix:* a new section, **Privacy & safety**, under My account, holding **Signed-in devices** and **Blocked people**.
- My account keeps the profile, status, password and Log out. This is the same "a home for each setting" rule as the P5 map.

**A2. The device list.**
- **"This device" is third. S.** The list is ordered by activity. *Fix:* put this device first, in its own row with a lime "This device" tag, then the others.
- **No limit on the list. S.** *Fix:* show five, then "Show 10 more".
- **"Unknown device" ×12. S.** That's a script or an app with no browser name. *Fix:* "Unknown browser", and identical consecutive labels collapse into one row with "×12" and **Sign out all of these**. That one is optional; "Sign out all other devices" already covers it.

**A3. Three kinds of "Sign out". S.** There's Sign out (a device), Sign out all other devices, and **Sign out** at the bottom, which logs *you* out here.
- *Fix:* the last one becomes **Log out**. The device actions keep "Sign out".

### Blocking

**B1. The collapsed row reads as part of the previous author's messages. S.** "3 blocked messages · Show" is 12 px grey italic, indented to the text column directly under bob's group (`shots/03-blocked-row.jpg`).
- *Fix:* a full-width row with its own spacing, an eye-off icon in the avatar column, and normal (not italic) text: "3 messages from someone you blocked · Show". It breaks author grouping above and below, like a notice.

**B2. Block looks like a moderator action in one place and not the other. S.** In the member menu, **Block…** is amber and sits next to **Time out…**, which is amber too (`shots/04-member-menu.jpg`). In the message menu it's plain.
- Blocking is personal: it affects only you.
- *Fix:* plain text with a ⊘ icon in both menus, in the personal group (Message, Roles…, Block…), above the divider. Moderation stays below it, in amber and red.

**B3. Blocked people vanish from search without a word. S.** New message › "dee" says "No one by that name in your servers. People you share a server with show up here." (`shots/06-picker-blocked-person.jpg`). That isn't true, and it leaves you wondering whether dee left.
- *Fix:* show the person, greyed, as "dee · You blocked them", with **Unblock**. The same goes for the group picker.

**B4. Nothing in the member list shows who you've blocked. S.** *Fix:* a small ⊘ after the name (with "blocked" for screen readers), in the member list and the group Members dialog.

**B5. No undo. S.** "Blocked dee" is a plain toast. *Fix:* add **Undo** to the toast, as deleting a message already has.

**B6. A bare ⊘ is the first icon in every 1-to-1 header. S.** It's one click from a confirm, and it sits right before **+** (Add people) and search. Muting a 1-to-1 isn't offered anywhere, although the server supports it.
- *Fix:* a **⋯** button holding Add people…, Mute, Block bob… and Search. Search can also stay as its own icon.

### Group DMs

**G1. The group picture is too small to read. S.**
- Each avatar is 23 px, and the front one covers about 60% of the back one, so you see "CA" and a sliver (`shots/21-dm-list-group-avatars.jpg`).
- A group with one other person (Squash Squad after bob left) shows one 23 px avatar in the top-left corner of its 32 px space, which looks broken.
- *Fix:*
  - One other member: their full-size avatar with a small group badge.
  - Two or more: two avatars at about 70%, overlapping by about a third, with a ring.
  - A named group can set a **ready-made group picture** instead: the P8 glyph tiles plus a new "group" glyph (section 4).

**G2. The preview doesn't say who spoke. S.** A group row's preview reads "Friday game night?". In a group you need "bob: Friday game night?" (or "You: …").

**G3. A new group gets the 1-to-1 art. S.** "This is the beginning of Gourd Club" shows the two-gourd picture.
- *Fix:* a three-gourd group scene built from `MascotParts` (no new art style), and the members' names under the title.

**G4. The Members dialog's buttons. S.** **Done** (a dark chip) looks secondary next to the pink **Leave group**, and **Add people** looks like a link (`shots/22-group-members-dialog.jpg`).
- *Fix:* Done becomes the filled primary button. Add people becomes a button with a + icon, disabled at 10 with "Groups hold up to 10 people".

### Image generation settings (site admin)

**I1. One style, two pages. M–L.**
- What's where today:
  - ComfyUI: the styles list, plus the style's Workflow, Model, Model type and Prompt prefix.
  - Quality › Advanced: a **Style** picker, then the style's sampler, scheduler, CFG, steps, hires steps, CLIP skip and negative prompt.
- The ComfyUI page also mixes in settings shared by every style (address, VRAM), under a "Shared by every style" heading placed *after* the style fields (`shots/09-style-editor.jpg`, `shots/10-quality-advanced-style.jpg`).
- *Fix:* a new **Styles** page in the Image generation group, between ComfyUI and Quality:
  - A **list on the left** (name, model, Default tag, Add / Duplicate / Delete) and the **style's editor on the right**: name, workflow, model, prompt prefix, and an **Advanced** fold with every per-style setting from Quality. On a phone, list → page, as the settings kit already does.
  - **ComfyUI** keeps the connection and the VRAM tier.
  - **Quality** keeps the shared settings only: hires fix, upscale button, face detailer.
  - The draft and Save don't change: `ImagineSettingsProvider` already splits shared and per-style fields.

**I2. Model names are cut off. S.** The model `<select>` sits in half a column, so "SDXL\Elldreth_Yume.safet…" is truncated. Advanced's three-up selects cut off "Default (dpmp…".
- *Fix:* the model picker takes the full width, with Model type under it. Advanced's selects go two-up.

**I3. Hires is mixed in with the Upscale button. S.** The first Quality card holds the Upscale model, Hires fix, Hires strength *and* the Upscale button's mode (`shots/11-quality-hires.jpg`).
- *Fix:* two cards. **Hires fix (High quality)**: the switch and its strength. **Upscale button**: the model (shared, noted on both) and its mode.

**I4. Strengths are bare number boxes. S.** Hires strength (0.45) and Face repaint strength (0.55) take 0–1.
- *Fix:* a slider with the value shown, ends labelled "closer to the original" and "more new detail", and a "Reset to 0.45" link.

**I5. kie.ai: the pictures note is a paragraph wedged between the model and the cap. S.** (`shots/12-kie-pictures.jpg`)
- *Fix:* a **Pictures** row with a short summary ("Grok Imagine image-to-image · no strength (one Variation button)") and the upload/24-hour note as help text under it.
- *Optional, needs a server field:* "Used 23 of 100 credits this month" with a thin bar, under the cap.

### The /imagine panel

**P1. Four chip groups without labels, and rows that come and go. M.**
- Shape, Quality, Engine and Style are runs of chips separated only by gaps (`shots/13-imagine-panel.jpg`).
- Picking kie.ai removes the Style row. Adding a picture removes the Shape row and adds Strength or a note (`shots/14…`, `shots/15…`). The panel changes height under your hands.
- *Fix:*
  - A small label before each group (Shape · Quality · Engine · Style · Strength), in the same 11 px caps as the settings headings.
  - A row that doesn't apply stays in place, dimmed, with a reason ("Style — ComfyUI only", "Shape — follows the picture"). The panel keeps its height.
  - On a phone the labels go above the chips.

### Rail and phone

**N1. Phones hide every badge behind the ☰. S.** The rail shows the DM count (red, bottom-right) and the reports count (amber, top-right). On a phone the rail lives in the drawer, so the channel header's ☰ gives no hint that anything is waiting (`shots/20-phone-channel.jpg`).
- *Fix:* a small dot on the ☰: red for unread DMs or mentions, amber for reports, red winning.

**N2. The amber count on light rails. S.** On the light theme the amber badge with its dark ring looks muddy at 16 px (`shots/18-light-group-dms.jpg`). Check its contrast (it wasn't flagged by axe, which skips small badges inside buttons) and use the light theme's amber-700 fill.

### Bugs found along the way
- **X1. Phone: Reports opens Server settings at the list, not at Reports. S.** Server menu › Reports (3) at 375 px opens the section list. You have to tap Reports again. `startOnPage` is passed, so something switches the view back to the list after it opens. *Reproduce, then fix in P10-01.*
- **X2. Group notice times fail contrast (axe, serious). S.** The time on "bob started the group 08:25 PM" is `text-gray-600` on ink-800: 3.19:1, against the 4.5:1 minimum for 12 px text. *Fix:* `text-gray-500`, as other timestamps use.
- **X3. The first view of #general showed "Welcome to #general" over a channel full of messages.** This happened once, on a fresh load. A second visit showed the messages. *Possibly a loading state drawn as empty. Recorded; not reproduced.*

### Checked and fine
- The Report dialog, the Reports page (both themes), the channel with a blocked row and the group members dialog pass axe, apart from X2.
- The blocked-DM bar copy, the transfer dialog's wording, and the devices' "Signed in Oct 20 · Active now" lines are clear.
- Group headers ("Gourd Club · 3 members"), centered notices and the typing line read well on a phone (`shots/17-phone-group.jpg`).
- Light theme: no new hard-coded dark colours in any Phase 9 screen (`shots/19-light-channel.jpg`).

## 3. Proposed passes (one packet and one PR each)

| Pass | What | Size | Files (main) | Server |
|---|---|---|---|---|
| **P10-01** | Reports: grouped cards, action hierarchy, nav count, quoted Report dialog, empty state, message-menu groups, phone deep link (R1–R6, X1) | M | ReportsSection, ReportDialog, MessageList menu, ServerSettingsDialog, SettingsLayout | none |
| **P10-02** | Privacy & safety page, device list order and limit, Log out wording (A1–A3) | S–M | ProfileDialog, DevicesSection, BlockedSection | none |
| **P10-03** | Blocking polish: the collapsed row, menu colours and grouping, picker states, member-list mark, Undo, DM header ⋯ with Mute (B1–B6) | M | MessageList, MemberList, DmPanel, PeoplePicker, QuickSwitcher (picker), App toasts | none |
| **P10-04** | Group DMs polish: GroupAvatar, sender in previews, group welcome art, Members dialog buttons, notice contrast (G1–G4, X2) | S–M | GroupAvatar, DmSidebar, DmPanel, GroupMembersDialog, MessageList | none |
| **P10-05** | Image generation: a Styles page, full-width model picker, Hires vs Upscale cards, strength sliders, kie.ai Pictures row (I1–I5) | M–L | ImagineSettings, new StylesPage, ComfyPage, QualityPage, KiePage, StylesSection | optional (credits used this month) |
| **P10-06** | /imagine panel: labelled groups, steady height (P1) | S–M | ImaginePanel | none |
| **P10-07** | Small things: transfer button and list, badge dot on ☰, light amber badge (T1, T2, N1, N2) | S | OverviewSection, TransferDialog, App header, ServerRail | none |
| **P10-08** | New art and sound (section 4) | S–M | mascotParts.js, serverGlyphs.js, sounds | none |

**Order.** P10-01 and P10-02 first: they're the most visible, and touch separate files. Some passes share files, so they go one after another:
- P10-03 and P10-04 both touch `MessageList` and `DmPanel`.
- P10-05 and P10-06 are independent of the rest.
- P10-08's poses are used by P10-01 (the empty queue) and P10-04 (the group welcome), so P10-08 can go before them, or they can ship with a plain empty state and pick the art up after.

## 4. New art and sound (kie.ai)

The owner has cleared kie.ai for any media. As in P8, kie.ai makes **reference sketches**; what ships is redrawn as theme-coloured SVG, so it follows the dark and light themes and stays tiny. Sounds ship as generated, trimmed and normalised, as in P5.

| Asset | Where | How | Estimated cost |
|---|---|---|---|
| Mascot pose **"all clear"**: a lime check in the bubble belly, leaf up | Empty Reports queue (R5); later any "done" state | nano-banana references ×2, then SVG in `mascotParts.js` | ~8 credits |
| Mascot **group scene**: three gourds, bubbles overlapping | A new group's welcome (G3); the empty DM list | references ×2, then built from `MascotParts` | ~8 credits |
| Mascot pose **"privacy"**: a small shield in the belly | Privacy & safety's empty Blocked list (A1) | references ×1, then SVG | ~4 credits |
| **Group glyph** (three bubbles) + 3 more tile glyphs | Ready-made group pictures (G1); server icons too | SVG, drawn directly | 0 |
| Sound: **report received** (moderators only, soft and two-note, distinct from the message pop) | When `reports_changed` raises the count | Suno "sounds", 3 takes | ~7.5 credits |
| Sound: **added to a group** (short rising pop) | `dm_group_created` / added | Suno "sounds", 2 takes | ~5 credits |
| *Optional:* a 6–8 s **looping mascot clip** for the README and the sign-in page on large screens | Marketing; the sign-in art's centre | A kie.ai video model. I'll check its price and show you a still first. A CSS/SVG loop (the leaf waving, the Zs drifting) may be the better answer: free, tiny and themeable. | to be quoted |

**Estimated total without video:** about 33 credits, against a balance of about 7,900. The PR will list the actual spend.

## 5. Decisions for the owner
1. **The Styles page (I1).** Move every per-style setting onto one Styles page, out of Quality › Advanced? *Recommended:* yes. It's the biggest clarity win and needs no server change.
2. **Privacy & safety (A1).** A new section for devices and blocked people? *Recommended:* yes.
3. **Report counts (R2).** Should the counts on the rail and the menu count *messages* (3 reports on 2 messages shows 2) rather than reports? *Recommended:* messages.
4. **The optional server fields.** "Credits used this month" on the kie.ai page, and "blocked on Oct 20" in the blocked list. Include them, or leave them out?
5. **Video.** Try a kie.ai video clip for the README and the sign-in page, or keep motion to CSS/SVG? *Recommended:* CSS/SVG in the app; a video clip only for the README, if you want one.
