import EmptyState from './EmptyState.jsx';
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import { unreadLabel } from '../util.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import UserFooter from './UserFooter.jsx';
import ServerSettingsDialog from './server-settings/ServerSettingsDialog.jsx';
import { MOD_LOG_ABILITIES } from './server-settings/ModLogSection.jsx';
import ChannelSettingsDialog from './ChannelSettingsDialog.jsx';
import { displayCaptureSupported } from '../audio.js';
import * as api from '../api.js';
import {
  buildGroups, layoutBody, moveCategory, moveChannel, moveChannelTo, visibleWhenCollapsed, loadCollapsed, saveCollapsed,
  dropChannel, dropCategory, channelDropTarget, categoryDropIndex,
} from '../channelLayout.js';

export default function ChannelList({
  space,
  channels,
  currentChannel,
  unread = {},
  mentions = {},
  voiceChannels = [],
  voiceParticipants = {},
  activeVoiceParticipants = [],
  myVoice,
  voiceMuted,
  voiceForcedMute = false, // P3-26c: timed out, so the mic stays off
  voiceDeafened,
  voicePttEnabled,
  voiceStatus,
  voiceMicError,
  voiceUnstable,
  voiceSharing,
  voiceShareError,
  voiceNotice,
  onDismissVoiceNotice,
  voiceCameraOn,
  voiceScreenOn,
  voiceVideoError,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
  onToggleDeafen,
  onToggleShare,
  onToggleShareMute,
  onSetShareVolume,
  onToggleCamera,
  onToggleScreen,
  selfId,
  onSelect,
  onCreateChannel,
  canManage,
  isOwner,
  onInvite,
  onDeleteServer,
  onLeaveServer,
  openReports = 0, // P9-01: open reports here, for moderators
  onJumpToReport, // (report) — go to a reported message
  onServerTransferred, // P9-02: (space, newOwner) after I handed it over
  onRenameServer,
  serverIcon = null, // the icon's URL, for Server settings › Overview
  onChangeServerIcon,
  onRemoveServerIcon,
  onUseServerGlyph, // P8: a ready-made icon's PNG file
  onReframeServerIcon,
  canReframeIcon,
  role,
  emoji = [], // the server's custom emoji (for the Server emoji dialog)
  canManageEmoji = false,
  // Roles (P2-21c): the server's roles (highest first), its members, and what
  // I may do — for the Roles screen and channel access.
  roles = [],
  members = [],
  canManageRoles = false,
  myPosition = 0,
  abilities = [],
  onRolesChanged,
  imagineInfo = null, // the server's /imagine info (GET /spaces), for its settings dialog
  channelMeta = {},
  categories = [], // P3-25b: the server's categories, in order
  onPermsChanged,
  user,
  avatar,
  onOpenProfile,
  status,
  presence,
  onSetPresence,
  statusText,
  statusEmoji,
  onEditStatus,
  onOpenShortcuts,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  // Closing the server menu by picking an item puts focus back on its button,
  // so a dialog the item opens has somewhere to return focus to.
  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  const canBan = !!isOwner || abilities.includes('ban_members');
  const canViewModLog = !!isOwner || MOD_LOG_ABILITIES.some((a) => abilities.includes(a));
  // Server settings (P5-04): which sections I may see; the menu offers the
  // window when there's at least one.
  const settingsCan = {
    owner: !!isOwner,
    overview: !!canManage || !!isOwner,
    emoji: !!canManageEmoji,
    roles: !!canManageRoles,
    imagine: !!canManage && !!imagineInfo,
    modLog: canViewModLog,
    bans: canBan,
    reports: !!isOwner || abilities.includes('delete_others_messages'), // P9-01
  };
  const anySettings = Object.entries(settingsCan).some(([k, v]) => k !== 'owner' && v);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelSettings, setChannelSettings] = useState(null); // channel name or null
  const gearRefs = useRef({}); // channel -> its settings gear, to return focus to

  // ---- Categories (P3-25b) ----
  const groups = buildGroups(categories, channelMeta, channels, voiceChannels);
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(space));
  const [collapsedFor, setCollapsedFor] = useState(space);
  if (collapsedFor !== space) {
    setCollapsedFor(space);
    setCollapsed(loadCollapsed(space));
  }
  const toggleCollapsed = (id) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveCollapsed(space, next);
  };
  const [creatingIn, setCreatingIn] = useState(undefined); // undefined: no form; null: the top; or a category id
  const [catMenu, setCatMenu] = useState(null);
  const [renamingCat, setRenamingCat] = useState(null);
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [arrangeError, setArrangeError] = useState('');
  const [catPerms, setCatPerms] = useState(null); // { id, name }: its permissions dialog (P3-25d)
  const [confirmMove, setConfirmMove] = useState(null); // { next, names, category } (P3-25d)
  // Send a new arrangement (the server tells everyone; the list reloads).
  // Moving channels into a category with its own access replaces theirs, so
  // that asks first (P3-25d).
  async function arrange(next, { confirmed = false } = {}) {
    if (!next) return;
    if (!confirmed) {
      const was = new Map(groups.flatMap((g) => g.items.map((i) => [i.name, g.id])));
      const into = next.flatMap((g) => g.items.filter((i) => g.id !== null && was.get(i.name) !== g.id).map((i) => ({ name: i.name, category: g })));
      const gated = into.filter((m) => categories.find((c) => c.id === m.category.id)?.hasOverrides);
      if (gated.length) {
        setConfirmMove({ next, names: gated.map((m) => m.name), category: gated[0].category.name });
        return;
      }
    }
    setArrangeError('');
    try {
      await api.setLayout(space, layoutBody(next));
    } catch (err) {
      setArrangeError(err.message || 'Could not move that');
    }
  }
  async function createIn(categoryId, channelName, type) {
    const trimmed = channelName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!trimmed) return;
    await onCreateChannel(trimmed, type, categoryId);
    setCreatingIn(undefined);
  }
  async function renameCat(id, value) {
    const next = value.trim();
    setRenamingCat(null);
    if (!next) return;
    try {
      await api.renameCategory(space, id, next);
    } catch (err) {
      setArrangeError(err.message || 'Could not rename the category');
    }
  }
  async function createCategory() {
    try {
      const made = await api.createCategory(space, 'New category');
      setRenamingCat(made.id);
    } catch (err) {
      setArrangeError(err.message || 'Could not create a category');
    }
  }
  // Where the channel whose settings are open sits, and its moves.
  const placementFor = (name) => {
    const gi = groups.findIndex((g) => g.items.some((i) => i.name === name));
    if (gi < 0) return null;
    const ii = groups[gi].items.findIndex((i) => i.name === name);
    return {
      categories,
      category: groups[gi].id,
      canUp: gi > 0 || ii > 0,
      canDown: gi < groups.length - 1 || ii < groups[gi].items.length - 1,
      onMove: (delta) => arrange(moveChannel(groups, name, delta)),
      onMoveTo: (id) => arrange(moveChannelTo(groups, name, id)),
    };
  };
  const renderItem = (item) => (item.type === 'voice' ? renderVoice(item.name) : renderText(item.name));

  // ---- Drag and drop (P3-25c): managers drag channels and category headings
  // with a mouse or pen (phones use the Move menus). A drag starts after 5 px;
  // Esc cancels; the click that ends a drag doesn't select anything. ----
  const navRef = useRef(null);
  const [drag, setDrag] = useState(null); // { kind: 'channel' | 'category', id, x, y, active }
  const [dropAt, setDropAt] = useState(null); // { group, index } or { catIndex }
  const dropRef = useRef(null);
  const swallowClick = useRef(false);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  function startDrag(e, kind, id) {
    if (!canManage || e.button !== 0 || e.pointerType === 'touch') return;
    setDrag({ kind, id, x: e.clientX, y: e.clientY, active: false });
  }
  useEffect(() => {
    if (!drag) return undefined;
    const readTargets = () => {
      const nav = navRef.current;
      if (!nav) return [];
      const group = (el) => (el.dataset.group === 'top' ? null : Number(el.dataset.group));
      return [...nav.querySelectorAll('[data-drop-row], [data-drop-heading]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { kind: el.hasAttribute('data-drop-row') ? 'row' : 'heading', group: group(el), index: Number(el.dataset.index || 0), top: r.top, bottom: r.bottom };
      });
    };
    const readSections = () => [...(navRef.current?.querySelectorAll('[data-drop-section]') || [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { index: Number(el.dataset.index), top: r.top, bottom: r.bottom };
    });
    const onMove = (e) => {
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
        setDrag((d) => d && { ...d, active: true });
      }
      const at = drag.kind === 'channel'
        ? channelDropTarget(readTargets(), e.clientY, groupsRef.current)
        : { catIndex: categoryDropIndex(readSections(), e.clientY, groupsRef.current.length) };
      dropRef.current = at;
      setDropAt(at);
    };
    const end = () => {
      setDrag(null);
      setDropAt(null);
      dropRef.current = null;
    };
    const onUp = () => {
      const at = dropRef.current;
      if (drag.active || at) {
        swallowClick.current = true;
        setTimeout(() => (swallowClick.current = false), 0);
      }
      if (at) {
        arrange(drag.kind === 'channel' ? dropChannel(groupsRef.current, drag.id, at.group, at.index) : dropCategory(groupsRef.current, drag.id, at.catIndex));
      }
      end();
    };
    const onKey = (e) => e.key === 'Escape' && end();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);
  const dragging = drag?.active ? drag : null;
  // The drop line takes no room (it's drawn over the gap), so rows don't shift
  // under the pointer while dragging.
  const line = <div data-testid="drop-line" aria-hidden="true" className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded-full bg-brand-hi" />;
  const dropLine = (groupId, index) =>
    dragging?.kind === 'channel' && dropAt && dropAt.group === groupId && dropAt.index === index ? line : null;
  const catLine = (index) => (dragging?.kind === 'category' && dropAt?.catIndex === index ? line : null);
  // A zero-height anchor for a line after the last row (or category).
  const endLine = (el) => (el ? <div className="relative h-0">{el}</div> : null);
  // A channel row in place: what drags, and where a drop would land.
  const placed = (g) => (item) => {
    const index = g.items.indexOf(item);
    return (
      <div
        key={item.name}
        data-drop-row=""
        data-group={g.id ?? 'top'}
        data-index={index}
        onPointerDown={canManage ? (e) => startDrag(e, 'channel', item.name) : undefined}
        className={`relative ${dragging?.kind === 'channel' && dragging.id === item.name ? 'opacity-40' : ''}`}
      >
        {dropLine(g.id, index)}
        {renderItem(item)}
      </div>
    );
  };
  const renderText = (c) => {
          const active = c === currentChannel;
          const hasUnread = (unread[c] || 0) > 0 && !active;
          const mentionCount = active ? 0 : mentions[c] || 0;
          // From the role overrides: what @everyone may do here.
          const access = channelMeta[c]?.private ? 'Private' : channelMeta[c]?.readOnly ? 'Read-only' : null;
          return (
            <div key={c} className="group relative mb-0.5">
              <button
                onClick={() => onSelect(c)}
                className={`tap-row flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
                  // Make room for the gear whenever it shows, so it doesn't cover the 18+ tag or badges.
                  canManage
                    ? channelSettings === c
                      ? 'pr-8 coarse:pr-13'
                      : 'group-hover:pr-8 group-focus-within:pr-8 coarse:group-hover:pr-13 coarse:group-focus-within:pr-13'
                    : ''
                } ${
                  active
                    ? 'bg-ink-600 text-fg'
                    : hasUnread || mentionCount
                      ? 'font-semibold text-fg hover:bg-ink-700/60'
                      : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
                }`}
              >
                <Icon name="hash" size={17} className="shrink-0 text-gray-500" />
                <span className="flex-1 truncate">{c}</span>
                {(hasUnread || mentionCount > 0) && (
                  <span className="sr-only">, {unreadLabel({ unread: hasUnread ? unread[c] : 0, mentions: mentionCount })}</span>
                )}
                {channelMeta[c]?.nsfw && (
                  <span title="Age-restricted (18+)" className="shrink-0 rounded-sm bg-ink-600 px-1 text-[10px] font-semibold text-gray-300">
                    18+
                  </span>
                )}
                {access && <span title={access} className="shrink-0 text-gray-500"><Icon name="shield" size={13} /></span>}
                {mentionCount > 0 ? (
                  <span aria-hidden="true" className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold leading-none text-ink-900 tabular-nums">
                    {mentionCount}
                  </span>
                ) : hasUnread ? (
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                ) : null}
              </button>
              {canManage && (
                <IconButton
                  icon="settings"
                  size={15}
                  label={`Channel settings for ${c}`}
                  title="Channel settings"
                  ref={(el) => (gearRefs.current[c] = el)}
                  onClick={() => setChannelSettings(c)}
                  className={`tap absolute right-1 top-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-ink-600 p-1 text-gray-300 hover:text-fg group-hover:flex group-focus-within:flex focus-visible:flex ${
                  // stays shown while its dialog is open, so focus can come back to it
                  channelSettings === c ? 'flex' : 'hidden'
                }`}
                />
              )}
            </div>
          );
  };
  const renderVoice = (vc) => {
  const inThis = myVoice && myVoice.channel === vc && myVoice.space === space;
  const people = inThis ? activeVoiceParticipants : voiceParticipants[vc] || [];
  return (
    <div key={vc} className="mb-0.5">
      <div className="group relative">
        <button
          onClick={() => onJoinVoice(space, vc)}
          className={`tap-row flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
            inThis ? 'bg-ink-600 text-fg' : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
          }`}
        >
          <Icon name="volume" size={17} className="shrink-0 text-gray-500" />
          <span className="flex-1 truncate">{vc}</span>
          {people.length > 0 && (
            <span className="text-xs text-gray-500 group-hover:hidden">{people.length}</span>
          )}
        </button>
        {canManage && (
          <IconButton
            icon="settings"
            size={15}
            label={`Channel settings for ${vc}`}
            title="Channel settings"
            ref={(el) => (gearRefs.current[vc] = el)}
            onClick={() => setChannelSettings(vc)}
            className={`tap absolute right-1 top-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-ink-600 p-1 text-gray-300 hover:text-fg group-hover:flex group-focus-within:flex focus-visible:flex ${
      // stays shown while its dialog is open, so focus can come back to it
      channelSettings === vc ? 'flex' : 'hidden'
    }`}
          />
        )}
      </div>
      {people.map((p) => (
        <div key={p.username}>
          <div className="flex items-center gap-2 py-0.5 pl-8 pr-2 text-sm text-gray-300">
            <Avatar name={p.username} size={20} src={p.avatar} status="online" speaking={p.speaking} />
            <span className="min-w-0 flex-1 truncate">{p.username}</span>
            {p.muted && <span title="Muted" className="shrink-0 text-danger"><Icon name="micOff" size={14} /></span>}
          </div>
          {p.sharing && (
            <ShareRow
              p={p}
              controllable={inThis && p.userId !== selfId}
              isSelf={p.userId === selfId}
              onToggleMute={() => onToggleShareMute(p.userId)}
              onVolume={(v) => onSetShareVolume(p.userId, v)}
            />
          )}
        </div>
      ))}
    </div>
  );
  };

  return (
    <nav ref={navRef} aria-label="Channels" className="flex w-60 flex-col border-r border-ink-900/50 bg-ink-800">
      <header className="relative flex h-12 items-center gap-2 border-b border-ink-900/60 px-2 shadow-xs shadow-black/20">
        {/* Server identity + the active highlight live in the left rail; the header
            just needs the name and its menu (the rest is in Server settings, P5-04). */}
        <button
          ref={menuButtonRef}
          onClick={() => space && setMenuOpen((v) => !v)}
          className="flex h-full flex-1 items-center justify-between rounded-sm px-2 hover:bg-ink-700/40"
        >
          <h2 className="truncate font-bold">{space || 'No server'}</h2>
          {space && <Icon name={menuOpen ? 'x' : 'chevronDown'} size={16} className="text-gray-400" />}
        </button>

        {menuOpen && space && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="anim-pop absolute left-2 right-2 top-11 z-20 rounded-lg bg-ink-900 p-1.5 shadow-xl ring-1 ring-ink-500/50">
              <MenuItem
                onClick={() => {
                  closeMenu();
                  onInvite();
                }}
              >
                <Icon name="plus" size={16} className="text-brand-hi" /> Invite people
              </MenuItem>
              {canManage && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    setCreatingIn(null);
                  }}
                >
                  <Icon name="plus" size={16} /> Create channel
                </MenuItem>
              )}
              {canManage && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    createCategory();
                  }}
                >
                  <Icon name="plus" size={16} /> Create category
                </MenuItem>
              )}
              {anySettings && (
                <>
                  <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-ink-500/60" />
                  <MenuItem
                    onClick={() => {
                      closeMenu();
                      setSettingsOpen(true);
                    }}
                  >
                    <Icon name="settings" size={16} /> Server settings
                  </MenuItem>
                  {settingsCan.reports && openReports > 0 && (
                    // Only while reports are open, so the menu stays short (P5-04).
                    <MenuItem
                      onClick={() => {
                        closeMenu();
                        setSettingsOpen('reports');
                      }}
                    >
                      <Icon name="flag" size={16} /> Reports
                      {openReports > 0 && (
                        <span className="ml-auto rounded-full bg-idle px-1.5 text-xs font-bold text-ink-900" aria-label={`${openReports} open`}>
                          {openReports}
                        </span>
                      )}
                    </MenuItem>
                  )}
                </>
              )}
              {!isOwner && onLeaveServer && (
                <>
                  <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-ink-500/60" />
                  <MenuItem
                    danger
                    onClick={() => {
                      closeMenu();
                      setConfirmLeave(true);
                    }}
                  >
                    <Icon name="logout" size={16} /> Leave server
                  </MenuItem>
                </>
              )}
            </div>
          </>
        )}
      </header>

      <div
        className={`flex-1 overflow-y-auto px-2 py-3 ${dragging ? 'cursor-grabbing select-none' : ''}`}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {creatingIn === null && (
          <CreateChannelForm onCancel={() => setCreatingIn(undefined)} onCreate={(n, type) => createIn(null, n, type)} />
        )}
        {groups.map((g) => {
          if (g.id === null) {
            return (
              <div key="top" className={dragging?.kind === 'channel' && !g.items.length ? 'min-h-2' : undefined}>
                {g.items.map(placed(g))}
                {endLine(dropLine(null, g.items.length))}
              </div>
            );
          }
          if (!canManage && g.items.length === 0) return null; // empty categories are for managers
          const isCollapsed = collapsed.has(g.id);
          const shown = isCollapsed ? g.items.filter((i) => visibleWhenCollapsed(i, { current: currentChannel, mentions, voiceChannel: myVoice?.space === space ? myVoice.channel : null })) : g.items;
          const gi = groups.indexOf(g);
          return (
            <section
              key={g.id}
              aria-label={g.name}
              data-drop-section=""
              data-index={gi}
              className={`relative mt-3 first:mt-0 ${dragging?.kind === 'category' && dragging.id === g.id ? 'opacity-40' : ''}`}
            >
              {catLine(gi)}
              <div data-drop-heading="" data-group={g.id} className="group/cat relative mb-1 flex items-center gap-1 pl-1 pr-1">
                {renamingCat === g.id ? (
                  <form
                    className="flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameCat(g.id, e.currentTarget.elements.name.value);
                    }}
                  >
                    <input
                      autoFocus
                      name="name"
                      aria-label="Category name"
                      defaultValue={g.name}
                      maxLength={50}
                      onBlur={() => setRenamingCat(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setRenamingCat(null)}
                      className="w-full rounded-sm bg-ink-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide outline-hidden ring-1 ring-brand-hi"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapsed(g.id)}
                    onPointerDown={canManage ? (e) => startDrag(e, 'category', g.id) : undefined}
                    className="tap-row flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200"
                  >
                    <Icon name="chevronDown" size={12} className={`shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="truncate">{g.name}</span>
                  </button>
                )}
                {canManage && renamingCat !== g.id && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCreatingIn(creatingIn === g.id ? undefined : g.id)}
                      title="Create channel"
                      aria-label={`Create channel in ${g.name}`}
                      aria-expanded={creatingIn === g.id}
                      className="tap flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-gray-400 hover:bg-ink-700 hover:text-fg"
                    >
                      <Icon name="plus" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatMenu(catMenu === g.id ? null : g.id)}
                      title="Category options"
                      aria-label={`Options for ${g.name}`}
                      aria-haspopup="menu"
                      aria-expanded={catMenu === g.id}
                      className="tap flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-gray-400 hover:bg-ink-700 hover:text-fg"
                    >
                      <Icon name="more" size={16} />
                    </button>
                  </>
                )}
                {catMenu === g.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setCatMenu(null)} />
                    <div role="menu" aria-label={`Options for ${g.name}`} className="anim-pop absolute right-0 top-6 z-20 w-44 rounded-lg bg-ink-900 p-1.5 shadow-xl ring-1 ring-ink-500/50">
                      <MenuItem role="menuitem" onClick={() => { setCatMenu(null); setRenamingCat(g.id); }}>
                        <Icon name="edit" size={16} /> Rename
                      </MenuItem>
                      <MenuItem role="menuitem" onClick={() => { setCatMenu(null); setCatPerms({ id: g.id, name: g.name }); }}>
                        <Icon name="shield" size={16} /> Permissions…
                      </MenuItem>
                      {gi > 1 && (
                        <MenuItem role="menuitem" onClick={() => { setCatMenu(null); arrange(moveCategory(groups, g.id, -1)); }}>
                          <Icon name="chevronDown" size={16} className="rotate-180" /> Move up
                        </MenuItem>
                      )}
                      {gi < groups.length - 1 && (
                        <MenuItem role="menuitem" onClick={() => { setCatMenu(null); arrange(moveCategory(groups, g.id, 1)); }}>
                          <Icon name="chevronDown" size={16} /> Move down
                        </MenuItem>
                      )}
                      <MenuItem role="menuitem" danger onClick={() => { setCatMenu(null); setConfirmDeleteCat(g); }}>
                        <Icon name="trash" size={16} /> Delete category
                      </MenuItem>
                    </div>
                  </>
                )}
              </div>
              {creatingIn === g.id && (
                <CreateChannelForm
                  defaultType={g.items.length && g.items.every((i) => i.type === 'voice') ? 'voice' : 'text'}
                  onCancel={() => setCreatingIn(undefined)}
                  onCreate={(n, type) => createIn(g.id, n, type)}
                />
              )}
              {shown.map(placed(g))}
              {endLine(dropLine(g.id, g.items.length))}
            </section>
          );
        })}
        {endLine(catLine(groups.length))}

        {space && channels.length === 0 && voiceChannels.length === 0 && creatingIn === undefined && (
          <EmptyState compact icon="hash" title="No channels yet" body={canManage ? 'Add one from the server menu or a category’s +.' : undefined} />
        )}
        {arrangeError && <p role="alert" className="mt-2 px-2 text-xs text-danger">{arrangeError}</p>}
      </div>

      {!myVoice && voiceNotice && (
        <div role="status" className="flex items-start gap-2 border-t border-ink-900/60 bg-idle/10 px-3 py-2 text-xs text-idle">
          <Icon name="volume" size={15} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{voiceNotice}</span>
          <button onClick={onDismissVoiceNotice} title="Dismiss" aria-label="Dismiss" className="shrink-0 rounded-sm px-1 hover:bg-ink-600">
            ✕
          </button>
        </div>
      )}
      {myVoice && (
        <div className="border-t border-ink-900/60 bg-ink-900/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <Icon name="volume" size={17} className={voiceMicError || voiceUnstable ? 'text-idle' : 'text-online'} />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-xs font-semibold ${voiceMicError || voiceUnstable ? 'text-idle' : 'text-online'}`}>
                {voiceStatus === 'connecting'
                  ? 'Connecting…'
                  : voiceUnstable
                    ? 'Reconnecting…'
                    : 'Voice connected'}
              </div>
              <div className="truncate text-xs text-gray-400">{myVoice.channel} · {myVoice.space}</div>
            </div>
            <button
              onClick={onLeaveVoice}
              title="Disconnect"
              className="rounded-sm bg-danger/80 px-2 py-1 text-xs font-semibold text-ink-900 hover:bg-danger"
            >
              Leave
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {!voiceMicError && (
              <IconButton
                icon={voiceMuted ? 'micOff' : 'mic'}
                size={17}
                label="Mute (Ctrl+Shift+M)"
                title={voiceForcedMute ? 'You’re timed out in this server, so your mic stays off' : voiceMuted ? 'Unmute (Ctrl+Shift+M)' : 'Mute (Ctrl+Shift+M)'}
                pressed={!!voiceMuted}
                disabled={voiceForcedMute}
                onClick={onToggleMute}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                  voiceMuted ? 'bg-danger/80 text-ink-900 hover:bg-danger' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
                }`}
              />
            )}
            <IconButton
              icon={voiceDeafened ? 'headphonesOff' : 'headphones'}
              size={17}
              label="Deafen (Ctrl+Shift+D)"
              title={voiceDeafened ? 'Undeafen (Ctrl+Shift+D)' : 'Deafen (Ctrl+Shift+D)'}
              pressed={!!voiceDeafened}
              onClick={onToggleDeafen}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                voiceDeafened ? 'bg-danger/80 text-ink-900 hover:bg-danger' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            />
            <IconButton
              icon="video"
              size={17}
              label="Camera"
              title={voiceCameraOn ? 'Turn camera off' : 'Turn camera on'}
              pressed={!!voiceCameraOn}
              onClick={onToggleCamera}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                voiceCameraOn ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            />
            {displayCaptureSupported() && (
              <IconButton
                icon="screen"
                size={17}
                label="Share your screen"
                title={voiceScreenOn ? 'Stop sharing your screen' : 'Share your screen'}
                pressed={!!voiceScreenOn}
                onClick={onToggleScreen}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                  voiceScreenOn ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
                }`}
              />
            )}
          </div>
          {displayCaptureSupported() && (
            <button
              onClick={onToggleShare}
              aria-pressed={!!voiceSharing}
              className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                voiceSharing
                  ? 'bg-danger/80 text-ink-900 hover:bg-danger'
                  : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            >
              <Icon name="music" size={15} />
              {voiceSharing ? 'Stop sharing audio' : 'Share app audio'}
            </button>
          )}
          {voiceShareError && <div className="mt-1 text-[11px] text-idle">{voiceShareError}</div>}
          {voiceVideoError && <div className="mt-1 text-[11px] text-idle">{voiceVideoError}</div>}
          {voicePttEnabled && !voiceMicError && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400"><Icon name="mic" size={12} className="shrink-0" /> Push-to-talk on — hold your key to speak.</div>
          )}
          {voiceMicError && (
            // One line (P5-06); "Why?" opens Settings › Voice & audio, which explains
            // and asks for microphone access.
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-idle">
              <Icon name="micOff" size={12} className="shrink-0" />
              <span className="min-w-0 truncate">No microphone: listening only.</span>
              <button
                type="button"
                onClick={() => onOpenProfile?.('audio')}
                title="Usually the site isn’t served over HTTPS, or microphone access was blocked"
                className="shrink-0 underline underline-offset-2 hover:text-fg"
              >
                Why?
              </button>
            </div>
          )}
        </div>
      )}

      <UserFooter
        user={user}
        avatar={avatar}
        status={status}
        presence={presence}
        onSetPresence={onSetPresence}
        statusText={statusText}
        statusEmoji={statusEmoji}
        onEditStatus={onEditStatus}
        onOpenShortcuts={onOpenShortcuts}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />

      {settingsOpen && space && (
        <ServerSettingsDialog
          space={space}
          can={settingsCan}
          initialSection={typeof settingsOpen === 'string' ? settingsOpen : undefined}
          onClose={() => setSettingsOpen(false)}
          overview={{
            icon: serverIcon,
            canEdit: !!canManage,
            canReframeIcon,
            onRename: onRenameServer,
            onChangeIcon: onChangeServerIcon,
            onRemoveIcon: onRemoveServerIcon,
            onUseGlyph: onUseServerGlyph,
            onReframeIcon: onReframeServerIcon,
            onDeleteServer,
            members,
            currentUser: user,
            onTransferred: (newOwner) => {
              setSettingsOpen(false); // what I may see in it changes
              onServerTransferred?.(space, newOwner);
            },
          }}
          emoji={{ emoji, onChanged: onPermsChanged }}
          roles={{ roles, members, currentUser: user, isOwner, myPosition, abilities, onChanged: onRolesChanged }}
          imagine={{ info: imagineInfo, onSaved: onPermsChanged }}
          modLog={{ members }}
          reports={{
            members,
            myPosition,
            isOwner,
            abilities,
            openCount: openReports,
            onJump: onJumpToReport
              ? (r) => {
                  setSettingsOpen(false);
                  onJumpToReport(r);
                }
              : undefined,
          }}
        />
      )}
      {channelSettings && (
        <ChannelSettingsDialog
          space={space}
          channel={channelSettings}
          meta={channelMeta[channelSettings]}
          placement={placementFor(channelSettings)}
          roles={roles}
          isOwner={isOwner}
          myPosition={myPosition}
          onClose={() => {
            // Focus the gear while it's still shown; focus keeps it shown after.
            gearRefs.current[channelSettings]?.focus();
            setChannelSettings(null);
          }}
          onSaved={onPermsChanged}
        />
      )}
      {catPerms && (
        <ChannelSettingsDialog
          space={space}
          category={catPerms}
          roles={roles}
          isOwner={isOwner}
          myPosition={myPosition}
          onClose={() => setCatPerms(null)}
          onSaved={onPermsChanged}
        />
      )}
      {confirmMove && (
        <ConfirmDialog
          title={`Move into ${confirmMove.category}?`}
          body={`${confirmMove.names.map((n) => `#${n}`).join(', ')} will take ${confirmMove.category}’s permissions, replacing ${confirmMove.names.length === 1 ? 'its' : 'their'} own.`}
          confirmLabel="Move"
          onCancel={() => setConfirmMove(null)}
          onConfirm={() => {
            const { next } = confirmMove;
            setConfirmMove(null);
            arrange(next, { confirmed: true });
          }}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title={`Leave ${space}?`}
          body="You won't be able to rejoin unless you get a new invite."
          confirmLabel="Leave server"
          danger
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            onLeaveServer();
          }}
        />
      )}
      {confirmDeleteCat && (
        <ConfirmDialog
          title={`Delete the ${confirmDeleteCat.name} category?`}
          body={`Its channels are kept: they move to the top of the list. Nothing is deleted but the category.`}
          confirmLabel="Delete category"
          danger
          onCancel={() => setConfirmDeleteCat(null)}
          onConfirm={async () => {
            const cat = confirmDeleteCat;
            setConfirmDeleteCat(null);
            try {
              await api.deleteCategory(space, cat.id);
            } catch (err) {
              setArrangeError(err.message || 'Could not delete the category');
            }
          }}
        />
      )}
    </nav>
  );
}

// The shared app audio shows as its own participant row. Each listener can mute
// or set its volume locally, independent of the sharer's voice.
function ShareRow({ p, controllable, isSelf, onToggleMute, onVolume }) {
  const vol = typeof p.shareVolume === 'number' ? p.shareVolume : 1;
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-14 pr-2 text-xs text-gray-400">
      <span className="-ml-3 select-none text-ink-500">↳</span>
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-ink-700 text-gray-300"><Icon name="music" size={11} /></span>
      <span className="min-w-0 flex-1 truncate">{p.username}’s audio</span>
      {isSelf && <span className="text-[10px] font-semibold uppercase text-gray-500">you</span>}
      {controllable && (
        <>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={vol}
            onChange={(e) => onVolume(parseFloat(e.target.value))}
            title="Volume (only for you)"
            aria-label={`${p.username}’s audio volume (only for you)`}
            className="h-1 w-14 accent-brand"
          />
          <IconButton
            icon={p.shareMutedLocally ? 'volumeOff' : 'volume'}
            size={14}
            label={`Mute ${p.username}’s audio for me`}
            title={p.shareMutedLocally ? 'Unmute for me' : 'Mute for me'}
            pressed={!!p.shareMutedLocally}
            onClick={onToggleMute}
            className={`flex h-6 w-6 items-center justify-center rounded-sm ${p.shareMutedLocally ? 'text-danger' : 'text-gray-400 hover:text-fg'}`}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger, role }) {
  return (
    <button
      role={role}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 ${
        danger ? 'text-danger' : 'text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

// A new channel's name and kind, inline in the list (P3-25b: per category).
function CreateChannelForm({ defaultType = 'text', onCreate, onCancel }) {
  const [value, setValue] = useState('');
  const [type, setType] = useState(defaultType);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(value, type);
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="mb-1 flex gap-1 px-1"
    >
      <input
        autoFocus
        aria-label="New channel name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={type === 'voice' ? 'voice-channel' : 'new-channel'}
        className="min-w-0 flex-1 rounded-sm bg-ink-900 px-2 py-1 text-sm outline-hidden ring-1 ring-ink-500 focus:ring-brand-hi"
      />
      <select
        aria-label="Channel type"
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="rounded-sm bg-ink-900 px-1 text-xs text-gray-300 ring-1 ring-ink-500"
      >
        <option value="text">Text</option>
        <option value="voice">Voice</option>
      </select>
    </form>
  );
}
