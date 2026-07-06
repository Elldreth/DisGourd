import { useRef, useState } from 'react';
import { initials, colorForName } from '../util.js';
import Avatar from './Avatar.jsx';
import UserFooter from './UserFooter.jsx';
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
  serverIcon,
  hasIcon,
  onChangeServerIcon,
  onRemoveServerIcon,
  user,
  avatar,
  onOpenProfile,
  status,
  onLogout,
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [addingVoice, setAddingVoice] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const iconInputRef = useRef(null);

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
    <div className="flex w-60 flex-col bg-ink-800">
      <header className="relative flex h-12 items-center gap-2 px-2 shadow-sm shadow-black/20">
        {space && (
          <button
            onClick={() => (canManage ? iconInputRef.current?.click() : setMenuOpen((v) => !v))}
            title={canManage ? 'Change server icon' : space}
            className="group relative h-8 w-8 shrink-0 overflow-hidden rounded-lg font-semibold text-white"
            style={{ backgroundColor: serverIcon ? undefined : colorForName(space) }}
          >
            {serverIcon ? (
              <img src={serverIcon} alt={space} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs">{initials(space)}</span>
            )}
            {canManage && (
              <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-sm group-hover:flex">
                📷
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => space && setMenuOpen((v) => !v)}
          className="flex h-full flex-1 items-center justify-between rounded px-2 hover:bg-ink-700/40"
        >
          <h2 className="truncate font-bold">{space || 'No server'}</h2>
          {space && <span className="text-gray-400">{menuOpen ? '✕' : '⌄'}</span>}
        </button>

        {menuOpen && space && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-2 right-2 top-11 z-20 rounded-lg bg-ink-900 p-1.5 shadow-xl ring-1 ring-ink-500/50">
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onInvite();
                }}
              >
                <span className="text-brand">＋</span> Invite people
              </MenuItem>
              {canManage && (
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    iconInputRef.current?.click();
                  }}
                >
                  🖼 {hasIcon ? 'Change icon' : 'Upload icon'}
                </MenuItem>
              )}
              {canManage && hasIcon && (
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveServerIcon();
                  }}
                >
                  🚫 Remove icon
                </MenuItem>
              )}
              {isOwner && (
                <MenuItem
                  danger
                  onClick={() => {
                    setMenuOpen(false);
                    if (window.confirm(`Delete the server “${space}” for everyone? This cannot be undone.`)) {
                      onDeleteServer();
                    }
                  }}
                >
                  🗑 Delete server
                </MenuItem>
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
              className="text-lg leading-none text-gray-400 hover:text-white"
            >
              +
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={submit} className="mb-1 px-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setAdding(false)}
              placeholder="new-channel"
              className="w-full rounded bg-ink-900 px-2 py-1 text-sm outline-none ring-1 ring-ink-500 focus:ring-brand"
            />
          </form>
        )}

        {channels.map((c) => {
          const active = c === currentChannel;
          const hasUnread = (unread[c] || 0) > 0 && !active;
          const mentionCount = active ? 0 : mentions[c] || 0;
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
                active
                  ? 'bg-ink-600 text-white'
                  : hasUnread || mentionCount
                    ? 'font-semibold text-white hover:bg-ink-700/60'
                    : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
              }`}
            >
              <span className="text-gray-500">#</span>
              <span className="flex-1 truncate">{c}</span>
              {mentionCount > 0 ? (
                <span className="shrink-0 rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                  {mentionCount}
                </span>
              ) : hasUnread ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />
              ) : null}
            </button>
          );
        })}

        {space && channels.length === 0 && !adding && (
          <p className="px-2 py-1 text-sm text-gray-500">No channels yet.</p>
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
                  className="text-lg leading-none text-gray-400 hover:text-white"
                >
                  +
                </button>
              )}
            </div>
            {addingVoice && (
              <form onSubmit={submitVoice} className="mb-1 px-1">
                <input
                  autoFocus
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  onBlur={() => !voiceName && setAddingVoice(false)}
                  placeholder="voice-channel"
                  className="w-full rounded bg-ink-900 px-2 py-1 text-sm outline-none ring-1 ring-ink-500 focus:ring-brand"
                />
              </form>
            )}
            {voiceChannels.map((vc) => {
              const inThis = myVoice && myVoice.channel === vc && myVoice.space === space;
              const people = inThis ? activeVoiceParticipants : voiceParticipants[vc] || [];
              return (
                <div key={vc} className="mb-0.5">
                  <button
                    onClick={() => onJoinVoice(space, vc)}
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
                      inThis ? 'bg-ink-600 text-white' : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
                    }`}
                  >
                    <span className="text-gray-500">🔊</span>
                    <span className="flex-1 truncate">{vc}</span>
                    {people.length > 0 && <span className="text-xs text-gray-500">{people.length}</span>}
                  </button>
                  {people.map((p) => (
                    <div key={p.username}>
                      <div className="flex items-center gap-2 py-0.5 pl-8 pr-2 text-sm text-gray-300">
                        <Avatar name={p.username} size={20} src={p.avatar} status="online" speaking={p.speaking} />
                        <span className="min-w-0 flex-1 truncate">{p.username}</span>
                        {p.muted && <span title="Muted" className="text-xs text-danger">🔇</span>}
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

      {myVoice && (
        <div className="border-t border-ink-900/60 bg-ink-900/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={voiceMicError || voiceUnstable ? 'text-idle' : 'text-online'}>🔊</span>
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
              className="rounded bg-danger/80 px-2 py-1 text-xs font-semibold text-white hover:bg-danger"
            >
              Leave
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {!voiceMicError && (
              <button
                onClick={onToggleMute}
                title={voiceMuted ? 'Unmute (Ctrl+Shift+M)' : 'Mute (Ctrl+Shift+M)'}
                className={`rounded px-2 py-1 text-sm ${
                  voiceMuted ? 'bg-danger/80 text-white hover:bg-danger' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
                }`}
              >
                {voiceMuted ? '🔇' : '🎤'}
              </button>
            )}
            <button
              onClick={onToggleDeafen}
              title={voiceDeafened ? 'Undeafen (Ctrl+Shift+D)' : 'Deafen (Ctrl+Shift+D)'}
              className={`rounded px-2 py-1 text-sm ${
                voiceDeafened ? 'bg-danger/80 text-white hover:bg-danger' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            >
              {voiceDeafened ? '🔕' : '🎧'}
            </button>
            <button
              onClick={onToggleCamera}
              title={voiceCameraOn ? 'Turn camera off' : 'Turn camera on'}
              className={`rounded px-2 py-1 text-sm ${
                voiceCameraOn ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            >
              📹
            </button>
            {displayCaptureSupported() && (
              <button
                onClick={onToggleScreen}
                title={voiceScreenOn ? 'Stop sharing your screen' : 'Share your screen'}
                className={`rounded px-2 py-1 text-sm ${
                  voiceScreenOn ? 'bg-brand text-white hover:bg-brand-hover' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
                }`}
              >
                🖥️
              </button>
            )}
          </div>
          {displayCaptureSupported() && (
            <button
              onClick={onToggleShare}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition ${
                voiceSharing
                  ? 'bg-danger/80 text-white hover:bg-danger'
                  : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            >
              {voiceSharing ? '⏹ Stop sharing audio' : '🎵 Share app audio'}
            </button>
          )}
          {voiceShareError && <div className="mt-1 text-[11px] text-idle">{voiceShareError}</div>}
          {voiceVideoError && <div className="mt-1 text-[11px] text-idle">{voiceVideoError}</div>}
          {voicePttEnabled && !voiceMicError && (
            <div className="mt-1 text-[11px] text-gray-400">🎙 Push-to-talk on — hold your key to speak.</div>
          )}
          {voiceMicError && (
            <div className="mt-1 text-[11px] text-idle">
              🎤 No microphone — you can hear others but not speak. This usually means the site
              isn’t served over HTTPS, or mic access was blocked.
            </div>
          )}
        </div>
      )}

      <UserFooter
        user={user}
        avatar={avatar}
        status={status}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
    </div>
  );
}

// The shared app audio shows as its own participant row. Each listener can mute
// or set its volume locally, independent of the sharer's voice.
function ShareRow({ p, controllable, isSelf, onToggleMute, onVolume }) {
  const vol = typeof p.shareVolume === 'number' ? p.shareVolume : 1;
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-14 pr-2 text-xs text-gray-400">
      <span className="-ml-3 select-none text-ink-500">↳</span>
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-ink-700 text-[10px]">🎵</span>
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
            className="h-1 w-14 accent-brand"
          />
          <button
            onClick={onToggleMute}
            title={p.shareMutedLocally ? 'Unmute for me' : 'Mute for me'}
            className={p.shareMutedLocally ? 'text-danger' : 'text-gray-400 hover:text-white'}
          >
            {p.shareMutedLocally ? '🔇' : '🔊'}
          </button>
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
