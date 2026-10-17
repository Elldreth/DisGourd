import { useEffect, useMemo, useState } from 'react';
import * as api from './api.js';
import { useGateway } from './useSocket.js';
import { useHandlerTable } from './state/gatewayHandlers.js';
import { useChannelMessages, badgeCounts } from './state/useChannelMessages.js';
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
import VideoStage from './components/VideoStage.jsx';
import MemberList from './components/MemberList.jsx';
import InviteDialog from './components/InviteDialog.jsx';
import ProfileDialog from './components/ProfileDialog.jsx';
import DmSidebar from './components/DmSidebar.jsx';
import DmPanel from './components/DmPanel.jsx';
import SearchOverlay from './components/SearchOverlay.jsx';
import ImageCropper from './components/ImageCropper.jsx';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile nav drawer (rail + sidebar)
  const [membersOpen, setMembersOpen] = useState(false); // member list drawer (below lg)
  const [authInfo, setAuthInfo] = useState(null); // { registration, setup } for the logged-out screen

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
  // Notifications need to know what you're looking at, and how to open what
  // a clicked notification is about.
  notifier.update({
    me: user,
    view,
    space: sp.currentSpace,
    channel: sp.currentChannel,
    dm: dm.current,
    openChannel: (space, channel) => openChannelFromSearch(space, channel),
    openDm: (name) => selectDm(name),
  });
  gatewayTable.fill(sp.handlers, voice.handlers, chat.handlers, dm.handlers);

  // ---- Navigation and session ----
  function logout() {
    voice.reset();
    api.clearToken();
    setToken('');
    sp.reset();
    chat.reset();
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
          messages={dm.messages}
          currentUser={user}
          typing={dm.typingNames}
          onSend={dm.send}
          onEdit={dm.edit}
          onDelete={dm.remove}
          hasMore={dm.hasMore}
          loadingOlder={dm.loadingOlder}
          onLoadOlder={dm.loadOlder}
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
              messages={chat.messages}
              currentUser={user}
              typingUsers={chat.typingNames}
              memberNames={sp.memberNames}
              onSend={chat.sendMessage}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
              canModerate={sp.canModerate}
              onReact={chat.react}
              hasMore={chat.hasMore}
              loadingOlder={chat.loadingOlder}
              onLoadOlder={chat.loadOlder}
              newMessages={chat.newMessages}
              onTyping={chat.sendTyping}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenNav={() => setNavOpen(true)}
              onOpenMembers={() => setMembersOpen(true)}
              membersOpen={membersOpen}
            />
          </div>
          <MemberList
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
          onOpenDm={openDmFromSearch}
        />
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
