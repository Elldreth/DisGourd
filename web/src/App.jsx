import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { useGateway } from './useSocket.js';
import { useHandlerTable } from './state/gatewayHandlers.js';
import { useChannelMessages, badgeCounts, unreadKey, threadRootId } from './state/useChannelMessages.js';
import { useDms } from './state/useDms.js';
import { useSpaces } from './state/useSpaces.js';
import { useVoiceCall } from './state/useVoiceCall.js';
import { useDocumentAttention } from './attention.js';
import { useNotifications } from './notify.js';
import Login from './components/Login.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelList from './components/ChannelList.jsx';
import Gourd from './components/Gourd.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ThreadPanel from './components/ThreadPanel.jsx';
import VideoStage from './components/VideoStage.jsx';
import MemberList from './components/MemberList.jsx';
import InviteDialog from './components/InviteDialog.jsx';
import ProfileDialog from './components/ProfileDialog.jsx';
import DmSidebar from './components/DmSidebar.jsx';
import DmPanel from './components/DmPanel.jsx';
import SearchOverlay from './components/SearchOverlay.jsx';
import ImageCropper from './components/ImageCropper.jsx';
import StatusDialog from './components/StatusDialog.jsx';
import { useToasts } from './components/Toasts.jsx';
import { useUndoDelete } from './state/useUndoDelete.js';
import QuickSwitcher, { itemKey, loadRecent, recordVisit } from './components/QuickSwitcher.jsx';
import { useShortcuts, stepChannel } from './shortcuts.js';
import { capturePendingInvite, clearPendingInvite } from './inviteLink.js';

// The signed-in app: wires the feature hooks (state/*) to the layout. Each hook
// owns one area's state, actions and gateway handlers.
export default function App() {
  const [token, setToken] = useState(api.getToken());
  const user = useMemo(() => {
    const p = api.decodeToken(token);
    return p ? p.name || p.username || p.sub : '';
  }, [token]);
  const myId = useMemo(() => {
    const p = api.decodeToken(token);
    return p ? p.sub : null;
  }, [token]);

  const [view, setView] = useState('server'); // 'server' | 'dm'
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  // Your chosen status (online | idle | dnd | invisible), kept on your profile.
  const presence = profile?.presence || 'online';
  // Your custom status ({ statusText, statusEmoji }), edited in a dialog.
  const [statusOpen, setStatusOpen] = useState(false);
  async function saveStatus({ statusText, statusEmoji, statusExpiresIn }) {
    const me = await api.updateMe({ statusText, statusEmoji, statusExpiresIn, tzOffset: new Date().getTimezoneOffset() });
    setProfile((p) => (p ? { ...p, statusText: me.statusText, statusEmoji: me.statusEmoji, statusExpiresAt: me.statusExpiresAt } : p));
  }
  async function setPresence(mode) {
    const before = presence;
    setProfile((p) => (p ? { ...p, presence: mode } : p));
    try {
      await api.updateMe({ presence: mode });
    } catch {
      setProfile((p) => (p ? { ...p, presence: before } : p)); // put it back
    }
  }
  const [searchOpen, setSearchOpen] = useState(false);
  const [switcher, setSwitcher] = useState(null); // { recent } while the Ctrl+K switcher is open
  const [navOpen, setNavOpen] = useState(false); // mobile nav drawer (rail + sidebar)
  const [membersOpen, setMembersOpen] = useState(false); // member list drawer (below lg)
  const [authInfo, setAuthInfo] = useState(null); // { registration, setup } for the logged-out screen
  // An invite link's code; it waits through sign-in, then ServerRail opens Join with it.
  const [pendingInvite, setPendingInvite] = useState(capturePendingInvite);

  // When logged out, find out whether this is a brand-new install (show setup).
  useEffect(() => {
    if (token) return;
    api.getAuthInfo().then(setAuthInfo).catch(() => setAuthInfo({ setup: false }));
  }, [token]);

  // If the server ever rejects our token (expired, or the server was reset),
  // drop it and return to the login/setup screen instead of getting stuck.
  useEffect(() => {
    api.setUnauthorizedHandler(() => setToken(''));
    return () => api.setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (token) api.getMe().then(setProfile).catch(() => {});
  }, [token]);

  // ---- Gateway (one connection for the whole app) and feature hooks ----
  // Order matters: each hook may use the ones above it.
  const gatewayTable = useHandlerTable();
  const { status, send, reconnects } = useGateway({ token, handlers: gatewayTable.handlers });
  const voice = useVoiceCall({ send, myId });
  const notifier = useNotifications();
  const dm = useDms({ active: view === 'dm', user, send, status, reconnects, onIncoming: notifier.onIncoming });
  const sp = useSpaces({
    token,
    myId,
    status,
    reconnects,
    view,
    dmCurrent: dm.current,
    onRestoreDm: (name) => {
      setView('dm');
      dm.select(name);
    },
  });
  const chat = useChannelMessages({
    space: sp.currentSpace,
    channel: sp.currentChannel,
    active: view === 'server',
    user,
    send,
    status,
    onIncoming: notifier.onIncoming,
  });
  // The open thread (a side panel next to the channel), with its own copy of
  // the channel machinery: { space, parentChannel, channel: '~tN', name,
  // rootMessageId, root? } or null.
  const [openThread, setOpenThread] = useState(null);
  const threadOpener = useRef(null); // what to focus again when it closes
  const thread = useChannelMessages({
    space: openThread?.space || '',
    channel: openThread?.channel || '',
    active: view === 'server' && !!openThread,
    user,
    send,
    status,
    threadOnly: true,
  });
  // `t` is a thread from a message summary, the threads list or a search
  // result; `root` is its root message when at hand, `opener` the element to
  // focus when it closes. `space`/`parentChannel` default to the open channel.
  function openThreadPanel(t, { root = null, opener = null, space = sp.currentSpace, parentChannel = sp.currentChannel } = {}) {
    threadOpener.current = opener || document.activeElement;
    setOpenThread({
      space,
      parentChannel: t.parentChannel || parentChannel,
      channel: t.channel,
      name: t.name,
      rootMessageId: t.rootMessageId ?? threadRootId(t.channel),
      root,
    });
  }
  function closeThread() {
    setOpenThread(null);
    const el = threadOpener.current;
    threadOpener.current = null;
    if (el && document.contains(el)) el.focus();
  }
  // Leaving the thread's channel closes it (silently: nothing to focus back to).
  useEffect(() => {
    if (openThread && (openThread.space !== sp.currentSpace || openThread.parentChannel !== sp.currentChannel)) {
      setOpenThread(null);
      threadOpener.current = null;
    }
  }, [openThread, sp.currentSpace, sp.currentChannel]);
  // Notifications need to know what you're looking at, and how to open what
  // a clicked notification is about.
  notifier.update({
    me: user,
    view,
    space: sp.currentSpace,
    channel: sp.currentChannel,
    dm: dm.current,
    dnd: presence === 'dnd', // Do Not Disturb: no notifications or sounds
    openChannel: (space, channel) => openChannelFromSearch(space, channel),
    openDm: (name) => selectDm(name),
  });
  gatewayTable.fill(sp.handlers, voice.handlers, chat.handlers, thread.handlers, dm.handlers, {
    // You changed your status in another tab.
    my_presence: (f) => setProfile((p) => (p ? { ...p, presence: f.mode } : p)),
    // Your custom status changed elsewhere, or its time ran out.
    my_status: (f) =>
      setProfile((p) => (p ? { ...p, statusText: f.statusText, statusEmoji: f.statusEmoji, statusExpiresAt: f.statusExpiresAt } : p)),
  });

  // Deleting a message: hidden at once with an Undo toast, sent after 5s.
  const toast = useToasts();
  const undoDelete = useUndoDelete({ toast });
  const chatMessagesRef = useRef(chat.messages);
  chatMessagesRef.current = chat.messages;
  const dmMessagesRef = useRef(dm.messages);
  dmMessagesRef.current = dm.messages;
  const threadMessagesRef = useRef(thread.messages);
  threadMessagesRef.current = thread.messages;
  const deleteChatMessage = (id) =>
    undoDelete.request(`c:${id}`, { send: () => chat.deleteMessage(id), exists: () => chatMessagesRef.current.some((m) => m.id === id) });
  const deleteThreadMessage = (id) =>
    undoDelete.request(`t:${id}`, { send: () => thread.deleteMessage(id), exists: () => threadMessagesRef.current.some((m) => m.id === id) });
  const deleteDmMessage = (id) =>
    undoDelete.request(`d:${id}`, { send: () => dm.remove(id), exists: () => dmMessagesRef.current.some((m) => m.id === id) });
  const shownChatMessages = chat.messages.filter((m) => !undoDelete.isHidden(`c:${m.id}`));
  const shownDmMessages = dm.messages.filter((m) => !undoDelete.isHidden(`d:${m.id}`));
  const shownThreadMessages = thread.messages.filter((m) => !undoDelete.isHidden(`t:${m.id}`));

  // ---- Navigation and session ----
  function logout() {
    voice.reset();
    api.clearToken();
    setToken('');
    sp.reset();
    chat.reset();
    thread.reset();
    setOpenThread(null);
    setProfile(null);
    setView('server');
    dm.reset();
  }

  function selectSpace(name) {
    setView('server');
    sp.selectSpace(name);
  }
  function openDms() {
    setView('dm'); // useDms loads the conversation list when the view opens
  }
  function selectDm(username) {
    setView('dm');
    dm.select(username);
  }
  function startDm(username) {
    if (!username || username === user) return;
    setView('dm');
    dm.open(username);
  }
  function openChannelFromSearch(space, channel) {
    setSearchOpen(false);
    setView('server');
    sp.openChannel(space, channel);
  }
  // A search hit inside a thread: go to its channel, then open the thread.
  function openThreadFromSearch(space, t) {
    setSearchOpen(false);
    setView('server');
    sp.openChannel(space, t.parentChannel);
    openThreadPanel(t, { space, parentChannel: t.parentChannel });
  }
  function openDmFromSearch(username) {
    setSearchOpen(false);
    startDm(username);
  }

  // Unread + mention badges: per-channel (for the current server) and per-server totals.
  const { channelUnread, channelMentions, spaceUnread, spaceMentions } = badgeCounts({
    unread: chat.unread, mentions: chat.mentions, spaces: sp.spaces, currentSpace: sp.currentSpace, channels: sp.channels,
  });
  const call = voice.call;
  // Browser tab: "(N) DisGourd" + a favicon dot for mentions and unread DMs.
  const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
  useDocumentAttention({ mentions: total(spaceMentions), dms: dm.totalUnread, unread: total(spaceUnread) });

  // ---- Keyboard shortcuts and the Ctrl+K quick switcher ----
  // Remember where you've been, so the switcher can rank recent places first.
  const here =
    view === 'dm'
      ? dm.current && itemKey({ kind: 'dm', username: dm.current })
      : sp.currentSpace && sp.currentChannel && itemKey({ kind: 'channel', space: sp.currentSpace, channel: sp.currentChannel });
  useEffect(() => {
    if (here) recordVisit(here, myId);
  }, [here, myId]);

  useShortcuts((action) => {
    if (!token) return;
    if (action === 'switcher') {
      if (dm.conversations.length === 0) dm.loadConversations(); // so DMs are listed too
      setSwitcher({ recent: loadRecent(myId) });
      return;
    }
    if (view !== 'server') return;
    const dir = action.startsWith('prev') ? -1 : 1;
    const want = action.endsWith('-unread') ? (c) => !!(channelUnread[c] || channelMentions[c]) : undefined;
    const to = stepChannel(sp.channels, sp.currentChannel, dir, want);
    if (to) sp.selectChannel(to);
  });

  const switcherItems = switcher
    ? [
        ...sp.orderedSpaces.flatMap((s) =>
          s.channels.map((c) => ({
            kind: 'channel',
            space: s.name,
            channel: c,
            unread: chat.unread[unreadKey(s.name, c)] || 0,
            mention: chat.mentions[unreadKey(s.name, c)] || 0,
          }))
        ),
        ...sp.orderedSpaces.map((s) => ({ kind: 'server', name: s.name, unread: spaceUnread[s.name] || 0, mention: spaceMentions[s.name] || 0 })),
        ...dm.conversations.map((d) => ({ kind: 'dm', username: d.username, unread: dm.unread[d.username] || 0 })),
      ]
    : [];
  function goToPicked(it) {
    setSwitcher(null);
    setNavOpen(false);
    if (it.kind === 'channel') {
      setView('server');
      sp.openChannel(it.space, it.channel);
    } else if (it.kind === 'server') selectSpace(it.name);
    else startDm(it.username);
  }

  if (!token) {
    if (!authInfo) {
      return (
        <div className="flex h-full items-center justify-center bg-ink-900">
          <Gourd size={56} className="animate-pulse" title="Loading DisGourd" />
        </div>
      );
    }
    return authInfo.setup ? <SetupWizard onAuthed={setToken} /> : <Login onAuthed={setToken} />;
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* Left navigation: static columns on desktop, a slide-in drawer on phones. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex shadow-2xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:shadow-none md:transition-none ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <ServerRail
          spaces={sp.orderedSpaces}
          currentSpace={view === 'server' ? sp.currentSpace : ''}
          unread={spaceUnread}
          mentions={spaceMentions}
          dmActive={view === 'dm'}
          dmUnread={dm.totalUnread}
          onSelectDms={openDms}
          onSelect={selectSpace}
          onCreate={sp.createSpace}
          onJoin={sp.joinServer}
          onReorder={sp.reorder}
          pendingInvite={pendingInvite}
          onInviteOpened={() => {
            clearPendingInvite();
            setPendingInvite('');
          }}
        />
        {view === 'dm' ? (
          <DmSidebar
            conversations={dm.conversations}
            currentDm={dm.current}
            unread={dm.unread}
            onSelect={(u) => {
              selectDm(u);
              setNavOpen(false);
            }}
            user={user}
            avatar={profile?.avatar}
            status={status}
            presence={presence}
            onSetPresence={setPresence}
            statusText={profile?.statusText}
            statusEmoji={profile?.statusEmoji}
            onEditStatus={() => setStatusOpen(true)}
            onOpenProfile={() => setProfileOpen(true)}
            onLogout={logout}
          />
        ) : (
          <ChannelList
            space={sp.currentSpace}
            channels={sp.channels}
            currentChannel={sp.currentChannel}
            unread={channelUnread}
            mentions={channelMentions}
            voiceChannels={sp.voiceChannels}
            voiceParticipants={voice.participantsFor(sp.currentSpace, sp.voiceChannels)}
            activeVoiceParticipants={call.participants}
            myVoice={call.room}
            voiceMuted={call.muted}
            voiceDeafened={call.deafened}
            voicePttEnabled={call.pttEnabled}
            voiceStatus={call.status}
            voiceMicError={call.micError}
            voiceUnstable={call.unstable}
            voiceSharing={call.sharing}
            voiceShareError={call.shareError}
            voiceNotice={call.notice}
            onDismissVoiceNotice={voice.dismissNotice}
            voiceCameraOn={call.cameraOn}
            voiceScreenOn={call.screenOn}
            voiceVideoError={call.videoError}
            onJoinVoice={voice.join}
            onLeaveVoice={voice.leave}
            onToggleMute={voice.toggleMute}
            onToggleDeafen={voice.toggleDeafen}
            onToggleShare={voice.toggleShare}
            onToggleShareMute={voice.toggleShareMute}
            onSetShareVolume={voice.setShareVolume}
            onToggleCamera={voice.toggleCamera}
            onToggleScreen={voice.toggleScreen}
            selfId={myId}
            onSelect={(c) => {
              sp.selectChannel(c);
              setNavOpen(false);
            }}
            onCreateChannel={sp.createChannel}
            canManage={sp.canManage}
            isOwner={sp.role === 'owner'}
            onInvite={sp.makeInvite}
            onDeleteServer={sp.deleteServer}
            onRenameServer={sp.renameServer}
            hasIcon={!!(sp.activeSpace && sp.activeSpace.icon)}
            onChangeServerIcon={sp.changeServerIcon}
            onRemoveServerIcon={sp.removeServerIcon}
            onReframeServerIcon={sp.reframeServerIcon}
            canReframeIcon={!!(sp.activeSpace && sp.activeSpace.iconOriginal)}
            role={sp.role}
            permissions={sp.activeSpace ? sp.activeSpace.permissions : null}
            channelMeta={sp.channelMeta}
            onPermsChanged={sp.reloadSpaces}
            user={user}
            avatar={profile?.avatar}
            presence={presence}
            onSetPresence={setPresence}
            statusText={profile?.statusText}
            statusEmoji={profile?.statusEmoji}
            onEditStatus={() => setStatusOpen(true)}
            onOpenProfile={() => setProfileOpen(true)}
            status={status}
            onLogout={logout}
          />
        )}
      </div>

      {/* Tap-to-close backdrop behind the open drawer (phones only). */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* Main content — full width on phones, alongside the nav on desktop. */}
      {view === 'dm' ? (
        <DmPanel
          username={dm.current}
          messages={shownDmMessages}
          currentUser={user}
          typing={dm.typingNames}
          onSend={dm.send}
          onEdit={dm.edit}
          onDelete={deleteDmMessage}
          hasMore={dm.hasMore}
          loadingOlder={dm.loadingOlder}
          onLoadOlder={dm.loadOlder}
          history={dm.history}
          onTyping={dm.sendTyping}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNav={() => setNavOpen(true)}
        />
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {call.room && call.videos.length > 0 && <VideoStage videos={call.videos} />}
            <ChatPanel
              space={sp.currentSpace}
              channel={sp.currentChannel}
              status={status}
              canPost={sp.canPostCurrent}
              messages={shownChatMessages}
              currentUser={user}
              typingUsers={chat.typingNames}
              memberNames={sp.memberNames}
              onSend={chat.sendMessage}
              onEdit={chat.editMessage}
              onDelete={deleteChatMessage}
              canModerate={sp.canModerate}
              canPin={sp.canPin}
              onSetPinned={chat.setPinned}
              pinsVersion={chat.pinsVersion}
              onReact={chat.react}
              hasMore={chat.hasMore}
              loadingOlder={chat.loadingOlder}
              onLoadOlder={chat.loadOlder}
              history={chat.history}
              newMessages={chat.newMessages}
              onTyping={chat.sendTyping}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenNav={() => setNavOpen(true)}
              onOpenMembers={() => setMembersOpen(true)}
              membersOpen={membersOpen}
              onOpenThread={openThreadPanel}
              threadsVersion={chat.threadsVersion}
            />
          </div>
          {openThread && (
            <ThreadPanel
              space={openThread.space}
              thread={openThread}
              status={status}
              canPost={sp.canPostCurrent}
              messages={shownThreadMessages}
              currentUser={user}
              typingUsers={thread.typingNames}
              memberNames={sp.memberNames}
              onSend={thread.sendMessage}
              onEdit={thread.editMessage}
              onDelete={deleteThreadMessage}
              canModerate={sp.canModerate}
              canPin={sp.canPin}
              onSetPinned={thread.setPinned}
              onReact={thread.react}
              hasMore={thread.hasMore}
              loadingOlder={thread.loadingOlder}
              onLoadOlder={thread.loadOlder}
              history={thread.history}
              onTyping={thread.sendTyping}
              onClose={closeThread}
            />
          )}
          <MemberList
            space={sp.currentSpace}
            members={sp.members}
            currentUser={user}
            myRole={sp.role}
            onMessageUser={(name) => {
              setMembersOpen(false);
              startDm(name);
            }}
            onSetRole={sp.changeMemberRole}
            onKick={sp.kickMember}
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
          />
        </>
      )}

      {sp.inviteCode && (
        <InviteDialog space={sp.currentSpace} code={sp.inviteCode} onClose={sp.closeInvite} />
      )}
      {profileOpen && profile && (
        <ProfileDialog
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onUpdated={setProfile}
          onOutputChange={voice.applyOutput}
          onPttChange={voice.refreshPtt}
          onMicChange={voice.switchMic}
          inCall={!!call.room}
        />
      )}
      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onOpenChannel={openChannelFromSearch}
          onOpenThread={openThreadFromSearch}
          onOpenDm={openDmFromSearch}
        />
      )}
      {switcher && (
        <QuickSwitcher items={switcherItems} recent={switcher.recent} onPick={goToPicked} onClose={() => setSwitcher(null)} />
      )}
      {statusOpen && (
        <StatusDialog current={profile || {}} onSave={saveStatus} onClose={() => setStatusOpen(false)} />
      )}
      {sp.iconCrop && (
        <ImageCropper
          src={sp.iconCrop.src}
          initialCrop={sp.iconCrop.initialCrop}
          shape="square"
          title="Position the server icon"
          onCancel={sp.cancelIconCrop}
          onSave={sp.saveServerIcon}
        />
      )}
      {sp.error && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-ink-900 shadow-lg">
          {sp.error}
        </div>
      )}
    </div>
  );
}
