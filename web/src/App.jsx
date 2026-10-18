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
import { imagineFor } from './components/ImaginePanel.jsx';
import { useImagine } from './state/useImagine.js';
import { RoleColorsContext } from './components/RoleName.jsx';
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
import QuickSwitcher, { itemKey, loadRecent, recordVisit, peopleItems } from './components/QuickSwitcher.jsx';
import { useShortcuts, stepChannel } from './shortcuts.js';
import { useOverlayHistory } from './overlayHistory.js';
import { capturePendingInvite, clearPendingInvite } from './inviteLink.js';
import { registerServiceWorker, onOpenRequest } from './pwa.js';

// The signed-in app: wires the feature hooks (state/*) to the layout. Each hook
// owns one area's state, actions and gateway handlers.
// Names stay uncoloured outside the open server.
const NO_COLORS = new Map();

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
  // The open thread (a side panel next to the channel): { space, parentChannel,
  // channel: '~tN', name, rootMessageId, root? } or null.
  const [openThread, setOpenThread] = useState(null);
  const chat = useChannelMessages({
    space: sp.currentSpace,
    channel: sp.currentChannel,
    active: view === 'server',
    user,
    send,
    status,
    onIncoming: notifier.onIncoming,
    openThread: openThread?.channel || '',
  });
  // The open thread has its own copy of the channel machinery.
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
    chat.clearUnread(space, t.channel); // its badge goes now; the panel tells the server
    setOpenThread({
      space,
      parentChannel: t.parentChannel || parentChannel,
      channel: t.channel,
      name: t.name,
      rootMessageId: t.rootMessageId ?? threadRootId(t.channel),
      root,
      archived: !!t.archived,
    });
  }
  function closeThread() {
    setOpenThread(null);
    const el = threadOpener.current;
    threadOpener.current = null;
    if (el && document.contains(el)) el.focus();
  }
  // Phones: the back button closes whichever of these is open (P4-07).
  useOverlayHistory('thread', !!openThread, closeThread);
  useOverlayHistory('members', membersOpen, () => setMembersOpen(false));
  useOverlayHistory('nav', navOpen, () => setNavOpen(false));
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
    thread: openThread?.channel || '',
    dm: dm.current,
    dnd: presence === 'dnd', // Do Not Disturb: no notifications or sounds
    openChannel: (space, channel) => openChannelFromSearch(space, channel),
    openDm: (name) => selectDm(name),
    openThread: (space, t) => openThreadFromSearch(space, t),
  });
  // "Create a server" / "Join with an invite" from the empty screen open the
  // rail's Add-a-server dialog (P3-20b).
  const [addServerRequest, setAddServerRequest] = useState(null);
  // /imagine requests (P2-20d); an accepted one refreshes "left today".
  const imagineReq = useImagine({ send, onQueued: () => sp.reloadSpaces() });
  gatewayTable.fill(sp.handlers, voice.handlers, chat.handlers, thread.handlers, dm.handlers, imagineReq.handlers, {
    // You changed your status in another tab.
    my_presence: (f) => setProfile((p) => (p ? { ...p, presence: f.mode } : p)),
    // Your custom status changed elsewhere, or its time ran out.
    my_status: (f) =>
      setProfile((p) => (p ? { ...p, statusText: f.statusText, statusEmoji: f.statusEmoji, statusExpiresAt: f.statusExpiresAt } : p)),
    // The open thread was archived or reopened (by the sweep, a reply, or a moderator).
    thread_updated: (f) =>
      setOpenThread((t) => (t && t.space === f.space && t.channel === f.thread?.channel ? { ...t, archived: !!f.thread.archived, name: f.thread.name } : t)),
  });

  // Deleting a message: hidden at once with an Undo toast, sent after 5s.
  const toast = useToasts();
  // The installable shell (production builds): when a new version has been
  // installed behind this one, offer to reload into it. Shown at the top so it
  // never covers the composer or the panels that open above it.
  useEffect(() => {
    registerServiceWorker({
      onUpdate: (apply) =>
        toast.show({
          id: 'sw-update',
          message: 'A new version of DisGourd is ready.',
          actionLabel: 'Reload',
          onAction: apply,
          duration: 10 * 60 * 1000,
          placement: 'top',
          dismissible: true,
        }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A push notification was clicked (in this tab, or it opened the app with
  // ?open=…): go to that DM, channel or thread.
  const openFromPush = useRef(null);
  openFromPush.current = (data) => {
    if (!data) return;
    if (data.dm) return startDm(data.dm);
    if (data.thread) return openThreadFromSearch(data.space, { channel: data.channel, name: data.thread.name, parentChannel: data.thread.parentChannel });
    if (data.space && data.channel) openChannelFromSearch(data.space, data.channel);
  };
  useEffect(() => onOpenRequest((data) => openFromPush.current(data)), []);
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
  // Creating or joining a server lands you in it, even from the DM view.
  // (Errors still reach the dialog, which shows them inline.)
  async function createServerAndShow(...args) {
    await sp.createSpace(...args);
    setView('server');
  }
  async function joinServerAndShow(...args) {
    await sp.joinServer(...args);
    setView('server');
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
  const { channelUnread, channelMentions, spaceUnread, spaceMentions, channelThreads } = badgeCounts({
    unread: chat.unread, mentions: chat.mentions, spaces: sp.spaces, currentSpace: sp.currentSpace, channels: sp.channels, threads: chat.threads,
  });
  // What a thread's summary or list row shows: its unread and mention counts.
  const threadBadge = (channel) => ({
    unread: chat.unread[unreadKey(sp.currentSpace, channel)] || 0,
    mentions: chat.mentions[unreadKey(sp.currentSpace, channel)] || 0,
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

  // "New message": the quick switcher in people mode. Members of every server
  // you're in are fetched when it opens (one small request per server); the
  // list shows your conversations straight away and fills in as they arrive.
  const [people, setPeople] = useState([]);
  function openPeoplePicker() {
    if (dm.conversations.length === 0) dm.loadConversations();
    setPeople([]);
    setSwitcher({ recent: loadRecent(myId), mode: 'people' });
    Promise.all(sp.spaces.map((s) => api.getMembers(s.name).then((r) => r.members || []).catch(() => []))).then((lists) =>
      setPeople(lists.flat())
    );
  }
  useShortcuts((action) => {
    if (!token) return;
    if (action === 'switcher') {
      if (dm.conversations.length === 0) dm.loadConversations(); // so DMs are listed too
      setSwitcher({ recent: loadRecent(myId) });
      return;
    }
    if (action === 'people') {
      openPeoplePicker();
      return;
    }
    if (view !== 'server') return;
    const dir = action.startsWith('prev') ? -1 : 1;
    const want = action.endsWith('-unread') ? (c) => !!(channelUnread[c] || channelMentions[c]) : undefined;
    const to = stepChannel(sp.channels, sp.currentChannel, dir, want);
    if (to) sp.selectChannel(to);
  });

  const switcherItems = !switcher
    ? []
    : switcher.mode === 'people'
      ? peopleItems({ me: user, conversations: dm.conversations, unread: dm.unread, members: people })
      : [
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
      ];
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
          onCreate={createServerAndShow}
          onJoin={joinServerAndShow}
          onReorder={sp.reorder}
          pendingInvite={pendingInvite}
          openRequest={addServerRequest}
          onInviteOpened={() => {
            clearPendingInvite();
            setPendingInvite('');
          }}
        />
        {view === 'dm' ? (
          <DmSidebar
            conversations={dm.conversations}
            currentDm={dm.current}
            onNewMessage={openPeoplePicker}
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
            roles={sp.roles}
            members={sp.members}
            canManageRoles={sp.canManageRoles}
            myPosition={sp.myPosition}
            abilities={sp.activeSpace?.abilities || []}
            onRolesChanged={sp.reloadRoles}
            imagineInfo={sp.activeSpace?.imagine || null}
            channelMeta={sp.channelMeta}
            onPermsChanged={sp.reloadSpaces}
            emoji={sp.activeSpace?.emoji || []}
            canManageEmoji={sp.canManageEmoji}
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
          newMessages={dm.newMessages}
          typing={dm.typingNames}
          onSend={dm.send}
          onEdit={dm.edit}
          onDelete={deleteDmMessage}
          hasMore={dm.hasMore}
          loadingOlder={dm.loadingOlder}
          onLoadOlder={dm.loadOlder}
          history={dm.history}
          onTyping={dm.sendTyping}
          onNewMessage={openPeoplePicker}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNav={() => setNavOpen(true)}
        />
      ) : (
        // Names take their role colours inside a server (P2-21d).
        <RoleColorsContext.Provider value={sp.nameColors}>
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
              threadBadge={threadBadge}
              threadsUnread={channelThreads[sp.currentChannel] || 0}
              emoji={sp.activeSpace?.emoji || []}
              imagine={imagineFor(sp.spaces, sp.currentSpace, sp.currentChannel, imagineReq.imagine)}
              topic={sp.channelMeta[sp.currentChannel]?.topic || null}
              onAddServer={sp.spaces.length === 0 ? (tab) => setAddServerRequest((r) => ({ tab, n: (r?.n || 0) + 1 })) : null}
            />
          </div>
          {openThread && (
            // A thread from another server (opened from the inbox) gets no colours.
            <RoleColorsContext.Provider value={openThread.space === sp.currentSpace ? sp.nameColors : NO_COLORS}>
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
              emoji={sp.activeSpace?.emoji || []}
              imagine={imagineFor(sp.spaces, openThread.space, openThread.channel, imagineReq.imagine)}
              followed={!!chat.threads[unreadKey(openThread.space, openThread.channel)]?.followed}
              onSetArchived={
                sp.canPin
                  ? (archived) => (archived ? api.archiveThread : api.reopenThread)(openThread.space, openThread.channel).catch(() => {})
                  : undefined
              }
              onToggleFollow={(follow) =>
                (follow ? api.followThread : api.unfollowThread)(openThread.space, openThread.channel).catch(() => {})
              }
            />
            </RoleColorsContext.Provider>
          )}
          <MemberList
            space={sp.currentSpace}
            members={sp.members}
            currentUser={user}
            myRole={sp.role}
            roles={sp.roles}
            canManageRoles={sp.canManageRoles}
            canKickMembers={sp.canKick}
            myPosition={sp.myPosition}
            onMessageUser={(name) => {
              setMembersOpen(false);
              startDm(name);
            }}
            onToggleRole={sp.setMemberHasRole}
            onKick={sp.kickMember}
            open={membersOpen}
            onClose={() => setMembersOpen(false)}
          />
        </RoleColorsContext.Provider>
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
        <QuickSwitcher mode={switcher.mode} items={switcherItems} recent={switcher.recent} onPick={goToPicked} onClose={() => setSwitcher(null)} />
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
