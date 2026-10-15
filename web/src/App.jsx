import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { useGateway } from './useSocket.js';
import { useHandlerTable } from './state/gatewayHandlers.js';
import { useChannelMessages, unreadKey, badgeCounts } from './state/useChannelMessages.js';
import { useDms } from './state/useDms.js';
import { createVoiceController } from './voice.js';
import { getPttEnabled, getPttKey } from './audio.js';
import {
  roleRank,
  loadViewState,
  saveViewState,
  loadServerOrder,
  saveServerOrder,
  applyServerOrder,
} from './util.js';
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

  const [spaces, setSpaces] = useState([]);
  const [serverOrder, setServerOrder] = useState([]); // user's custom rail order
  const [currentSpace, setCurrentSpace] = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // mobile nav drawer (rail + sidebar)
  const [iconCrop, setIconCrop] = useState(null); // { src: File|url, initialCrop } while framing a server icon
  const [voiceStates, setVoiceStates] = useState({}); // "space channel" -> participants[]
  const [voiceCall, setVoiceCall] = useState({ room: null, status: 'idle', muted: false, deafened: false, pttEnabled: false, micError: false, unstable: false, sharing: false, shareError: '', cameraOn: false, screenOn: false, videoError: '', videos: [], participants: [] });
  const myVoice = voiceCall.room;
  const [loadError, setLoadError] = useState('');
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

  // Direct messages
  const [view, setView] = useState('server'); // 'server' | 'dm'

  // Refs so gateway handlers (created once) can read the latest selection.
  const spaceRef = useRef(currentSpace);
  spaceRef.current = currentSpace;
  const channelRef = useRef(currentChannel);
  channelRef.current = currentChannel;

  // Apply the user's custom server ordering for the rail.
  const orderedSpaces = useMemo(() => applyServerOrder(spaces, serverOrder), [spaces, serverOrder]);
  function reorderServers(names) {
    setServerOrder(names);
    saveServerOrder(myId, names);
  }

  const activeSpace = spaces.find((s) => s.name === currentSpace);
  const channels = activeSpace ? activeSpace.channels : [];
  const role = activeSpace ? activeSpace.role : null;
  const canManage = role === 'owner' || role === 'admin';
  const myRank = roleRank(role);
  const channelMeta = activeSpace ? activeSpace.channelMeta || {} : {};
  const currentChannelPost = channelMeta[currentChannel]?.post ?? 1;
  const canPostCurrent = myRank >= currentChannelPost;
  // Whether I may delete someone else's message: my role meets the server's
  // "delete others' messages" threshold and the author ranks below me (people
  // who left rank 0). Mirrors the server check, which has the final say.
  const moderationThreshold = activeSpace?.permissions?.delete_others_messages ?? 2;
  const canModerate = myRank >= moderationThreshold
    ? (author) => roleRank(members.find((mb) => mb.username === author)?.role) < myRank
    : null;

  async function loadSpaces() {
    try {
      const next = await api.getSpaces();
      setSpaces(next);
      setLoadError('');
      return next;
    } catch (err) {
      setLoadError(err.message || 'Could not reach the server');
      return [];
    }
  }

  function refreshMembers(space) {
    if (!space) return;
    api.getMembers(space).then((r) => setMembers(r.members || [])).catch(() => {});
  }

  // Initial load after auth. Restore whatever the user was last looking at.
  useEffect(() => {
    if (!token) return;
    loadSpaces().then((next) => {
      if (spaceRef.current) return; // already positioned (e.g. arrived via invite)
      const saved = loadViewState(myId);
      if (saved && saved.view === 'dm' && saved.dm) {
        setView('dm');
        dm.select(saved.dm);
        return;
      }
      if (saved && saved.space) {
        const s = next.find((x) => x.name === saved.space);
        if (s) {
          setCurrentSpace(saved.space);
          setCurrentChannel(s.channels.includes(saved.channel) ? saved.channel : s.channels[0] || '');
          return;
        }
      }
      if (next.length) {
        setCurrentSpace(next[0].name);
        setCurrentChannel(next[0].channels[0] || '');
      }
    });
    api.getMe().then(setProfile).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load the saved rail order once we know who's signed in.
  useEffect(() => {
    if (myId) setServerOrder(loadServerOrder(myId));
  }, [myId]);

  // ---- Gateway (one connection for the whole app) ----
  // Feature hooks add their frame handlers to this table (filled below).
  const gatewayTable = useHandlerTable();
  const { status, send } = useGateway({ token, handlers: gatewayTable.handlers });
  const chat = useChannelMessages({
    space: currentSpace,
    channel: currentChannel,
    active: view === 'server',
    user,
    send,
    status,
  });
  const dm = useDms({ active: view === 'dm', user, send, status });

  // Persist the current view so a refresh returns you to the same place.
  useEffect(() => {
    if (!token || !myId) return;
    if (view === 'server' && !currentSpace) return; // don't clobber saved state with the empty first render
    saveViewState(myId, { view, space: currentSpace, channel: currentChannel, dm: dm.current });
  }, [token, myId, view, currentSpace, currentChannel, dm.current]);

  const handlers = useMemo(
    () => ({
      presence: (p) => {
        setMembers((prev) =>
          prev.map((m) => (m.username === p.user ? { ...m, online: p.status === 'online' } : m))
        );
      },
      channel_created: () => loadSpaces(),
      channel_deleted: (f) => {
        loadSpaces().then((next) => {
          if (spaceRef.current === f.space && channelRef.current === f.channel) {
            const s = next.find((x) => x.name === f.space);
            setCurrentChannel(s && s.channels[0] ? s.channels[0] : '');
          }
        });
      },
      space_deleted: (f) => {
        loadSpaces().then((next) => {
          if (spaceRef.current === f.space) {
            const first = next[0];
            setCurrentSpace(first ? first.name : '');
            setCurrentChannel(first && first.channels[0] ? first.channels[0] : '');
          }
        });
      },
      space_left: (f) => {
        // You were removed from a server, or left it.
        loadSpaces().then((next) => {
          if (spaceRef.current === f.space) {
            const first = next[0];
            setCurrentSpace(first ? first.name : '');
            setCurrentChannel(first && first.channels[0] ? first.channels[0] : '');
          }
        });
      },
      members_changed: (f) => {
        if (f.space === spaceRef.current) refreshMembers(f.space);
        // A role change may affect *our own* permissions/channel visibility, so
        // refresh the space list too (updates role, gears, hidden channels).
        loadSpaces();
      },
      space_updated: () => loadSpaces(),
      space_renamed: (f) => {
        loadSpaces().then(() => {
          if (spaceRef.current === f.space) setCurrentSpace(f.newName);
        });
      },
      voice_state: (f) => {
        setVoiceStates((prev) => ({ ...prev, [unreadKey(f.space, f.channel)]: f.participants || [] }));
        voiceRef.current && voiceRef.current.handleState(f);
      },
      voice_peers: (f) => voiceRef.current && voiceRef.current.handlePeers(f.peers || []),
      voice_peer_joined: (f) => voiceRef.current && voiceRef.current.handlePeerJoined(f.peer),
      voice_peer_left: (f) => voiceRef.current && voiceRef.current.handlePeerLeft(f.userId),
      voice_signal: (f) => voiceRef.current && voiceRef.current.handleSignal(f.from, f.data),
    }),
    []
  );

  gatewayTable.fill(handlers, chat.handlers, dm.handlers);

  // Voice controller (WebRTC mesh). Recreated per session; tears down its call
  // when the user (or the session) changes.
  const voiceRef = useRef(null);
  useEffect(() => {
    voiceRef.current = createVoiceController({ send, myId, onChange: setVoiceCall });
    return () => voiceRef.current && voiceRef.current.leave();
  }, [myId, send]);

  // Voice keyboard shortcuts, active only while in a call. Note: browsers only
  // deliver these while the DisGourd window is focused (no true global hotkeys
  // without a desktop wrapper). Mute/deafen use modifiers so they're safe even
  // while typing; push-to-talk is ignored while a text field is focused.
  useEffect(() => {
    if (!voiceCall.room) return undefined;
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === 'KeyM') { e.preventDefault(); toggleMute(); return; }
        if (e.code === 'KeyD') { e.preventDefault(); toggleDeafen(); return; }
      }
      if (getPttEnabled() && getPttKey() && e.code === getPttKey() && !e.repeat && !isTyping()) {
        e.preventDefault();
        if (voiceRef.current) voiceRef.current.setPttActive(true);
      }
    };
    const onKeyUp = (e) => {
      if (getPttEnabled() && e.code === getPttKey() && voiceRef.current) {
        voiceRef.current.setPttActive(false);
      }
    };
    const releasePtt = () => voiceRef.current && voiceRef.current.setPttActive(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releasePtt);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releasePtt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceCall.room]);

  // If the current channel becomes hidden to us (permissions changed), fall back
  // to the first channel we can still see.
  useEffect(() => {
    if (view === 'server' && currentChannel && channels.length && !channels.includes(currentChannel)) {
      setCurrentChannel(channels[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, currentChannel, view]);

  // Load members on server switch and when the gateway (re)connects.
  useEffect(() => {
    if (!currentSpace) {
      setMembers([]);
      return;
    }
    refreshMembers(currentSpace);
  }, [currentSpace, status]);

  // ---- Actions ----
  function logout() {
    if (voiceRef.current) voiceRef.current.leave();
    setVoiceStates({});
    api.clearToken();
    setToken('');
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    chat.reset();
    setMembers([]);
    setProfile(null);
    setView('server');
    dm.reset();
  }

  function selectSpace(name) {
    setView('server');
    setCurrentSpace(name);
    const s = spaces.find((x) => x.name === name);
    setCurrentChannel(s && s.channels[0] ? s.channels[0] : '');
  }

  function openDms() {
    setView('dm');
    dm.loadConversations();
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
    setCurrentSpace(space);
    setCurrentChannel(channel);
  }
  function openDmFromSearch(username) {
    setSearchOpen(false);
    startDm(username);
  }

  async function createSpace(name) {
    try {
      await api.createSpace(name);
      await loadSpaces();
      setCurrentSpace(name);
      setCurrentChannel('general');
    } catch (err) {
      setLoadError(err.message || 'Could not create server');
    }
  }

  async function joinServer(code) {
    try {
      const res = await api.joinInvite(code.trim());
      const next = await loadSpaces();
      setCurrentSpace(res.name);
      const s = next.find((x) => x.name === res.name);
      setCurrentChannel(s && s.channels[0] ? s.channels[0] : 'general');
    } catch (err) {
      setLoadError(err.message || 'Could not join server');
    }
  }

  async function createChannel(name, type = 'text') {
    if (!currentSpace) return;
    try {
      const created = await api.createChannel(currentSpace, name, type);
      const next = await loadSpaces();
      const s = next.find((x) => x.name === currentSpace);
      if (type === 'text' && s && created.name && s.channels.includes(created.name)) {
        setCurrentChannel(created.name);
      }
    } catch (err) {
      setLoadError(err.message || 'Could not create channel');
    }
  }

  function joinVoice(space, channel) {
    if (myVoice && myVoice.space === space && myVoice.channel === channel) return;
    if (voiceRef.current) voiceRef.current.join(space, channel);
  }
  function leaveVoice() {
    if (voiceRef.current) voiceRef.current.leave();
  }
  function toggleMute() {
    if (voiceRef.current) voiceRef.current.toggleMute();
  }
  function toggleDeafen() {
    if (voiceRef.current) voiceRef.current.toggleDeafen();
  }
  function refreshPtt() {
    if (voiceRef.current) voiceRef.current.refreshPtt();
  }
  function switchMic() {
    if (voiceRef.current) voiceRef.current.switchMic();
  }
  function toggleShareAudio() {
    if (voiceRef.current) voiceRef.current.toggleShare();
  }
  function toggleShareMute(userId) {
    if (voiceRef.current) voiceRef.current.toggleShareMute(userId);
  }
  function setShareVolume(userId, vol) {
    if (voiceRef.current) voiceRef.current.setShareVolume(userId, vol);
  }
  function toggleCamera() {
    if (voiceRef.current) voiceRef.current.toggleCamera();
  }
  function toggleScreenShare() {
    if (voiceRef.current) voiceRef.current.toggleScreen();
  }

  async function makeInvite() {
    try {
      const res = await api.createInvite(currentSpace);
      setInviteCode(res.code);
    } catch (err) {
      setLoadError(err.message || 'Could not create invite');
    }
  }

  async function changeMemberRole(username, newRole) {
    try {
      await api.setMemberRole(currentSpace, username, newRole);
      refreshMembers(currentSpace);
    } catch (err) {
      setLoadError(err.message || 'Could not change role');
    }
  }

  async function kickMember(username) {
    try {
      await api.kickMember(currentSpace, username);
      refreshMembers(currentSpace);
    } catch (err) {
      setLoadError(err.message || 'Could not remove member');
    }
  }

  async function deleteServer() {
    if (!currentSpace) return;
    try {
      await api.deleteSpace(currentSpace);
      // The gateway also broadcasts space_deleted; refresh proactively.
      const next = await loadSpaces();
      const first = next[0];
      setCurrentSpace(first ? first.name : '');
      setCurrentChannel(first && first.channels[0] ? first.channels[0] : '');
    } catch (err) {
      setLoadError(err.message || 'Could not delete server');
    }
  }

  function changeServerIcon(file) {
    if (!currentSpace || !file) return;
    if (!file.type.startsWith('image/')) {
      setLoadError('Please choose an image file for the server icon');
      return;
    }
    setIconCrop({ src: file, initialCrop: null }); // frame it before uploading
  }
  function reframeServerIcon() {
    if (!activeSpace?.iconOriginal) return;
    setIconCrop({ src: activeSpace.iconOriginal, initialCrop: activeSpace.iconCrop || null });
  }
  async function saveServerIcon({ blob, crop }) {
    if (!currentSpace || !iconCrop) return;
    try {
      // Keep the original so the icon can be re-framed later without re-uploading.
      const original = typeof iconCrop.src === 'string' ? iconCrop.src : (await api.uploadFile(iconCrop.src)).url;
      const up = await api.uploadFile(blob);
      await api.setSpaceIcon(currentSpace, up.url, original, crop);
      await loadSpaces();
      setIconCrop(null);
    } catch (err) {
      setLoadError(err.message || 'Could not update the server icon');
    }
  }
  async function removeServerIcon() {
    if (!currentSpace) return;
    try {
      await api.setSpaceIcon(currentSpace, '');
      await loadSpaces();
    } catch (err) {
      setLoadError(err.message || 'Could not remove the server icon');
    }
  }
  async function renameServer(newName) {
    const trimmed = (newName || '').trim();
    if (!currentSpace || !trimmed || trimmed === currentSpace) return;
    try {
      const res = await api.renameSpace(currentSpace, trimmed);
      const finalName = res?.name || trimmed;
      // Keep the server in the same spot in the rail across the rename.
      const order = loadServerOrder(myId);
      if (order.includes(currentSpace)) {
        const nextOrder = order.map((n) => (n === currentSpace ? finalName : n));
        saveServerOrder(myId, nextOrder);
        setServerOrder(nextOrder);
      }
      setCurrentSpace(finalName);
      await loadSpaces();
    } catch (err) {
      setLoadError(err.message || 'Could not rename the server');
    }
  }

  // Unread + mention badges: per-channel (for the current server) and per-server totals.
  const { channelUnread, channelMentions, spaceUnread, spaceMentions } = badgeCounts({
    unread: chat.unread, mentions: chat.mentions, spaces, currentSpace, channels,
  });
  const memberNames = members.map((m) => m.username);

  const voiceChannels = activeSpace ? activeSpace.voiceChannels || [] : [];
  const voiceParticipantsByChannel = {};
  for (const vc of voiceChannels) {
    voiceParticipantsByChannel[vc] = voiceStates[unreadKey(currentSpace, vc)] || [];
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
          spaces={orderedSpaces}
          currentSpace={view === 'server' ? currentSpace : ''}
          unread={spaceUnread}
          mentions={spaceMentions}
          dmActive={view === 'dm'}
          dmUnread={dm.totalUnread}
          onSelectDms={openDms}
          onSelect={selectSpace}
          onCreate={createSpace}
          onJoin={joinServer}
          onReorder={reorderServers}
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
            space={currentSpace}
            channels={channels}
            currentChannel={currentChannel}
            unread={channelUnread}
            mentions={channelMentions}
            voiceChannels={voiceChannels}
            voiceParticipants={voiceParticipantsByChannel}
            activeVoiceParticipants={voiceCall.participants}
            myVoice={myVoice}
            voiceMuted={voiceCall.muted}
            voiceDeafened={voiceCall.deafened}
            voicePttEnabled={voiceCall.pttEnabled}
            voiceStatus={voiceCall.status}
            voiceMicError={voiceCall.micError}
            voiceUnstable={voiceCall.unstable}
            voiceSharing={voiceCall.sharing}
            voiceShareError={voiceCall.shareError}
            voiceCameraOn={voiceCall.cameraOn}
            voiceScreenOn={voiceCall.screenOn}
            voiceVideoError={voiceCall.videoError}
            onJoinVoice={joinVoice}
            onLeaveVoice={leaveVoice}
            onToggleMute={toggleMute}
            onToggleDeafen={toggleDeafen}
            onToggleShare={toggleShareAudio}
            onToggleShareMute={toggleShareMute}
            onSetShareVolume={setShareVolume}
            onToggleCamera={toggleCamera}
            onToggleScreen={toggleScreenShare}
            selfId={myId}
            onSelect={(c) => {
              setCurrentChannel(c);
              setNavOpen(false);
            }}
            onCreateChannel={createChannel}
            canManage={canManage}
            isOwner={role === 'owner'}
            onInvite={makeInvite}
            onDeleteServer={deleteServer}
            onRenameServer={renameServer}
            hasIcon={!!(activeSpace && activeSpace.icon)}
            onChangeServerIcon={changeServerIcon}
            onRemoveServerIcon={removeServerIcon}
            onReframeServerIcon={reframeServerIcon}
            canReframeIcon={!!(activeSpace && activeSpace.iconOriginal)}
            role={role}
            permissions={activeSpace ? activeSpace.permissions : null}
            channelMeta={channelMeta}
            onPermsChanged={loadSpaces}
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
            {voiceCall.room && voiceCall.videos.length > 0 && <VideoStage videos={voiceCall.videos} />}
            <ChatPanel
              space={currentSpace}
              channel={currentChannel}
              status={status}
              canPost={canPostCurrent}
              messages={chat.messages}
              currentUser={user}
              typingUsers={chat.typingNames}
              memberNames={memberNames}
              onSend={chat.sendMessage}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
              canModerate={canModerate}
              onReact={chat.react}
              hasMore={chat.hasMore}
              loadingOlder={chat.loadingOlder}
              onLoadOlder={chat.loadOlder}
              onTyping={chat.sendTyping}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenNav={() => setNavOpen(true)}
            />
          </div>
          <MemberList
            members={members}
            currentUser={user}
            myRole={role}
            onMessageUser={startDm}
            onSetRole={changeMemberRole}
            onKick={kickMember}
          />
        </>
      )}

      {inviteCode && (
        <InviteDialog space={currentSpace} code={inviteCode} onClose={() => setInviteCode(null)} />
      )}
      {profileOpen && profile && (
        <ProfileDialog
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onUpdated={setProfile}
          onOutputChange={() => voiceRef.current && voiceRef.current.applyOutput()}
          onPttChange={refreshPtt}
          onMicChange={switchMic}
          inCall={!!myVoice}
        />
      )}
      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onOpenChannel={openChannelFromSearch}
          onOpenDm={openDmFromSearch}
        />
      )}
      {iconCrop && (
        <ImageCropper
          src={iconCrop.src}
          initialCrop={iconCrop.initialCrop}
          shape="square"
          title="Position the server icon"
          onCancel={() => setIconCrop(null)}
          onSave={saveServerIcon}
        />
      )}
      {loadError && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-ink-900 shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  );
}
