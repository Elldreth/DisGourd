import EmptyState from './EmptyState.jsx';
import { useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import { unreadLabel } from '../util.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import UserFooter from './UserFooter.jsx';
import ServerPermissionsDialog from './ServerPermissionsDialog.jsx';
import ChannelSettingsDialog from './ChannelSettingsDialog.jsx';
import { displayCaptureSupported } from '../audio.js';

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
  onRenameServer,
  hasIcon,
  onChangeServerIcon,
  onRemoveServerIcon,
  onReframeServerIcon,
  canReframeIcon,
  role,
  permissions,
  channelMeta = {},
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
  onLogout,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [addingVoice, setAddingVoice] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false);
  // Closing the server menu by picking an item puts focus back on its button,
  // so a dialog the item opens has somewhere to return focus to.
  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  const [permsOpen, setPermsOpen] = useState(false);
  const [channelSettings, setChannelSettings] = useState(null); // channel name or null
  const gearRefs = useRef({}); // channel -> its settings gear, to return focus to
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const iconInputRef = useRef(null);

  function startRename() {
    setRenameValue(space);
    setRenaming(true);
    setMenuOpen(false);
  }
  function submitRename(e) {
    e.preventDefault();
    const next = renameValue.trim();
    if (next && next !== space) onRenameServer(next);
    setRenaming(false);
  }

  async function submit(e) {
    e.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, '-').toLowerCase();
    if (!trimmed) return;
    await onCreateChannel(trimmed);
    setName('');
    setAdding(false);
  }

  async function submitVoice(e) {
    e.preventDefault();
    const trimmed = voiceName.trim().replace(/\s+/g, '-').toLowerCase();
    if (!trimmed) return;
    await onCreateChannel(trimmed, 'voice');
    setVoiceName('');
    setAddingVoice(false);
  }

  return (
    <nav aria-label="Channels" className="flex w-60 flex-col border-r border-ink-900/50 bg-ink-800">
      <header className="relative flex h-12 items-center gap-2 border-b border-ink-900/60 px-2 shadow-xs shadow-black/20">
        {/* Server identity + the active highlight live in the left rail; the header
            just needs the name and its menu (which holds change/reposition icon). */}
        {renaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              maxLength={60}
              className="w-full rounded-sm bg-ink-900 px-2 py-1 text-sm font-bold outline-hidden ring-1 ring-brand-hi"
            />
          </form>
        ) : (
          <button
            ref={menuButtonRef}
            onClick={() => space && setMenuOpen((v) => !v)}
            className="flex h-full flex-1 items-center justify-between rounded-sm px-2 hover:bg-ink-700/40"
          >
            <h2 className="truncate font-bold">{space || 'No server'}</h2>
            {space && <Icon name={menuOpen ? 'x' : 'chevronDown'} size={16} className="text-gray-400" />}
          </button>
        )}

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
                <MenuItem onClick={startRename}>
                  <Icon name="edit" size={16} /> Rename server
                </MenuItem>
              )}
              {canManage && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    iconInputRef.current?.click();
                  }}
                >
                  <Icon name="image" size={16} /> {hasIcon ? 'Change icon' : 'Upload icon'}
                </MenuItem>
              )}
              {canManage && canReframeIcon && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    onReframeServerIcon();
                  }}
                >
                  <Icon name="image" size={16} /> Reposition icon
                </MenuItem>
              )}
              {canManage && hasIcon && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    onRemoveServerIcon();
                  }}
                >
                  <Icon name="ban" size={16} /> Remove icon
                </MenuItem>
              )}
              {isOwner && (
                <MenuItem
                  onClick={() => {
                    closeMenu();
                    setPermsOpen(true);
                  }}
                >
                  <Icon name="shield" size={16} /> Permissions
                </MenuItem>
              )}
              {isOwner && (
                <>
                  <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-ink-500/60" />
                  <MenuItem
                    danger
                    onClick={() => {
                      closeMenu();
                      setConfirmDeleteServer(true);
                    }}
                  >
                    <Icon name="trash" size={16} /> Delete server
                  </MenuItem>
                </>
              )}
            </div>
          </>
        )}
        <input
          ref={iconInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onChangeServerIcon(file);
          }}
        />
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Text channels
          </span>
          {space && canManage && (
            <button
              onClick={() => setAdding((v) => !v)}
              title="Create channel"
              aria-label="Create channel"
              aria-expanded={adding}
              className="tap flex h-5 w-5 items-center justify-center rounded-sm text-gray-400 hover:bg-ink-700 hover:text-fg"
            >
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={submit} className="mb-1 px-1">
            <input
              autoFocus
              aria-label="New channel name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setAdding(false)}
              placeholder="new-channel"
              className="w-full rounded-sm bg-ink-900 px-2 py-1 text-sm outline-hidden ring-1 ring-ink-500 focus:ring-brand-hi"
            />
          </form>
        )}

        {channels.map((c) => {
          const active = c === currentChannel;
          const hasUnread = (unread[c] || 0) > 0 && !active;
          const mentionCount = active ? 0 : mentions[c] || 0;
          const restricted = (channelMeta[c]?.view ?? 1) > 1 || (channelMeta[c]?.post ?? 1) > 1;
          return (
            <div key={c} className="group relative mb-0.5">
              <button
                onClick={() => onSelect(c)}
                className={`tap-row flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
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
                {restricted && <span title="Restricted access" className="shrink-0 text-gray-500"><Icon name="shield" size={13} /></span>}
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
        })}

        {space && channels.length === 0 && !adding && (
          <EmptyState compact icon="hash" title="No channels yet" body={canManage ? 'Add one with the + above.' : undefined} />
        )}

        {/* Voice channels */}
        {space && (voiceChannels.length > 0 || canManage) && (
          <>
            <div className="mb-1 mt-4 flex items-center justify-between px-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Voice channels
              </span>
              {canManage && (
                <button
                  onClick={() => setAddingVoice((v) => !v)}
                  title="Create voice channel"
                  aria-label="Create voice channel"
                  aria-expanded={addingVoice}
                  className="tap flex h-5 w-5 items-center justify-center rounded-sm text-gray-400 hover:bg-ink-700 hover:text-fg"
                >
                  <Icon name="plus" size={16} />
                </button>
              )}
            </div>
            {addingVoice && (
              <form onSubmit={submitVoice} className="mb-1 px-1">
                <input
                  autoFocus
                  aria-label="New voice channel name"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  onBlur={() => !voiceName && setAddingVoice(false)}
                  placeholder="voice-channel"
                  className="w-full rounded-sm bg-ink-900 px-2 py-1 text-sm outline-hidden ring-1 ring-ink-500 focus:ring-brand-hi"
                />
              </form>
            )}
            {voiceChannels.map((vc) => {
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
            })}
          </>
        )}
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
                title={voiceMuted ? 'Unmute (Ctrl+Shift+M)' : 'Mute (Ctrl+Shift+M)'}
                pressed={!!voiceMuted}
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
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-idle">
              <Icon name="micOff" size={12} className="mt-0.5 shrink-0" />
              <span>No microphone — you can hear others but not speak. This usually means the site
              isn’t served over HTTPS, or mic access was blocked.</span>
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
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />

      {permsOpen && (
        <ServerPermissionsDialog
          space={space}
          permissions={permissions || {}}
          onClose={() => setPermsOpen(false)}
          onSaved={onPermsChanged}
        />
      )}
      {confirmDeleteServer && (
        <ConfirmDialog
          title={`Delete ${space}?`}
          body="This deletes the server, its channels and all messages for everyone. It can't be undone."
          confirmLabel="Delete server"
          danger
          requireText={space}
          onCancel={() => setConfirmDeleteServer(false)}
          onConfirm={() => {
            setConfirmDeleteServer(false);
            onDeleteServer();
          }}
        />
      )}
      {channelSettings && (
        <ChannelSettingsDialog
          space={space}
          channel={channelSettings}
          meta={channelMeta[channelSettings]}
          onClose={() => {
            // Focus the gear while it's still shown; focus keeps it shown after.
            gearRefs.current[channelSettings]?.focus();
            setChannelSettings(null);
          }}
          onSaved={onPermsChanged}
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

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 ${
        danger ? 'text-danger' : 'text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
