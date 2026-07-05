import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { useGateway } from './useSocket.js';
import { createVoiceController } from './voice.js';
import { getPttEnabled, getPttKey } from './audio.js';
import { mergeMessages } from './util.js';
import Login from './components/Login.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelList from './components/ChannelList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import MemberList from './components/MemberList.jsx';
import InviteDialog from './components/InviteDialog.jsx';
import ProfileDialog from './components/ProfileDialog.jsx';
import DmSidebar from './components/DmSidebar.jsx';
import DmPanel from './components/DmPanel.jsx';
import SearchOverlay from './components/SearchOverlay.jsx';

const unreadKey = (space, channel) => JSON.stringify([space, channel]);

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
  const [currentSpace, setCurrentSpace] = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [unread, setUnread] = useState({}); // "space channel" -> count
  const [mentions, setMentions] = useState({}); // "space channel" -> mention count
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [voiceStates, setVoiceStates] = useState({}); // "space channel" -> participants[]
  const [voiceCall, setVoiceCall] = useState({ room: null, status: 'idle', muted: false, deafened: false, pttEnabled: false, micError: false, unstable: false, sharing: false, shareError: '', participants: [] });
  const myVoice = voiceCall.room;
  const [loadError, setLoadError] = useState('');

  // Direct messages
  const [view, setView] = useState('server'); // 'server' | 'dm'
  const [dms, setDms] = useState([]); // conversation list
  const [currentDm, setCurrentDm] = useState(''); // partner username
  const [dmMessages, setDmMessages] = useState([]);
  const [dmUnread, setDmUnread] = useState({}); // username -> count
  const [dmTyping, setDmTyping] = useState({}); // username -> expires-at ms

  // Refs so gateway handlers (created once) can read the latest selection.
  const spaceRef = useRef(currentSpace);
  spaceRef.current = currentSpace;
  const channelRef = useRef(currentChannel);
  channelRef.current = currentChannel;
  const viewRef = useRef(view);
  viewRef.current = view;
  const dmRef = useRef(currentDm);
  dmRef.current = currentDm;
  const userRef = useRef(user);
  userRef.current = user;

  const activeSpace = spaces.find((s) => s.name === currentSpace);
  const channels = activeSpace ? activeSpace.channels : [];
  const role = activeSpace ? activeSpace.role : null;
  const canManage = role === 'owner' || role === 'admin';

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

  function loadDms() {
    api.getDms().then(setDms).catch(() => {});
  }

  // Initial load after auth.
  useEffect(() => {
    if (!token) return;
    loadSpaces().then((next) => {
      if (next.length && !spaceRef.current) {
        setCurrentSpace(next[0].name);
        setCurrentChannel(next[0].channels[0] || '');
      }
    });
    api.getMe().then(setProfile).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---- Gateway (one connection for the whole app) ----
  const handlers = useMemo(
    () => ({
      message: (m) => {
        const focused = m.space === spaceRef.current && m.channel === channelRef.current;
        if (focused) {
          setMessages((prev) => mergeMessages(prev, [m]));
          if (m.id) send({ op: 'read', space: m.space, channel: m.channel, lastId: m.id });
        } else {
          const k = unreadKey(m.space, m.channel);
          setUnread((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
          if (m.mentions && m.mentions.includes(userRef.current)) {
            setMentions((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
          }
        }
      },
      unread: (f) => {
        const map = {};
        for (const c of f.counts || []) map[unreadKey(c.space, c.channel)] = c.count;
        setUnread(map);
        const mmap = {};
        for (const c of f.mentions || []) mmap[unreadKey(c.space, c.channel)] = c.count;
        setMentions(mmap);
      },
      message_update: (u) => {
        if (u.space === spaceRef.current && u.channel === channelRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === u.id ? { ...m, content: u.content, editedAt: u.editedAt } : m))
          );
        }
      },
      message_delete: (d) => {
        if (d.space === spaceRef.current && d.channel === channelRef.current) {
          setMessages((prev) => prev.filter((m) => m.id !== d.id));
        }
      },
      reaction: (r) => {
        if (r.space !== spaceRef.current || r.channel !== channelRef.current) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== r.id) return m;
            const others = (m.reactions || []).filter((x) => x.emoji !== r.emoji);
            const next = r.count > 0 ? [...others, { emoji: r.emoji, count: r.count, users: r.users }] : others;
            return { ...m, reactions: next };
          })
        );
      },
      typing: (t) => {
        if (t.space === spaceRef.current && t.channel === channelRef.current) {
          setTypingUsers((prev) => ({ ...prev, [t.user]: Date.now() + 4000 }));
        }
      },
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
      },
      voice_state: (f) => {
        setVoiceStates((prev) => ({ ...prev, [unreadKey(f.space, f.channel)]: f.participants || [] }));
        voiceRef.current && voiceRef.current.handleState(f);
      },
      voice_peers: (f) => voiceRef.current && voiceRef.current.handlePeers(f.peers || []),
      voice_peer_joined: (f) => voiceRef.current && voiceRef.current.handlePeerJoined(f.peer),
      voice_peer_left: (f) => voiceRef.current && voiceRef.current.handlePeerLeft(f.userId),
      voice_signal: (f) => voiceRef.current && voiceRef.current.handleSignal(f.from, f.data),
      dm: (m) => {
        const me = userRef.current;
        const partner = m.from === me ? m.to : m.from;
        const viewing = viewRef.current === 'dm' && dmRef.current === partner;
        if (viewing) {
          // Normalize the live frame to the shared message shape (author/authorAvatar).
          const normalized = {
            id: m.id,
            author: m.from,
            authorAvatar: m.fromAvatar,
            content: m.content,
            attachment: m.attachment,
            spoiler: m.spoiler,
            timestamp: m.timestamp,
          };
          setDmMessages((prev) => mergeMessages(prev, [normalized]));
          if (m.id) send({ op: 'dm_read', with: partner, lastId: m.id });
        } else if (m.from !== me) {
          setDmUnread((prev) => ({ ...prev, [partner]: (prev[partner] || 0) + 1 }));
        }
        if (viewRef.current === 'dm') loadDms(); // refresh previews/order
      },
      dm_typing: (t) => {
        if (viewRef.current === 'dm' && dmRef.current === t.from) {
          setDmTyping((prev) => ({ ...prev, [t.from]: Date.now() + 4000 }));
        }
      },
      dm_unread: (f) => {
        const map = {};
        for (const c of f.counts || []) map[c.with] = c.count;
        setDmUnread(map);
      },
    }),
    []
  );

  const { status, send } = useGateway({ token, handlers });

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

  // Clear the transcript immediately when switching channels.
  useEffect(() => {
    setMessages([]);
    setTypingUsers({});
  }, [currentSpace, currentChannel]);

  // Focus the active channel and (re)load its history — also on reconnect.
  useEffect(() => {
    if (view !== 'server' || !currentSpace || !currentChannel) return undefined;
    send({ op: 'focus', space: currentSpace, channel: currentChannel });
    let cancelled = false;
    api
      .getMessages(currentSpace, currentChannel)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        // This channel is now read up to its latest message.
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        send({ op: 'read', space: currentSpace, channel: currentChannel, lastId: maxId });
        const k = unreadKey(currentSpace, currentChannel);
        const clearKey = (setter) =>
          setter((prev) => {
            if (!prev[k]) return prev;
            const next = { ...prev };
            delete next[k];
            return next;
          });
        clearKey(setUnread);
        clearKey(setMentions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, currentSpace, currentChannel, status, send]);

  // Focus + load a DM conversation (also on reconnect).
  useEffect(() => {
    if (view !== 'dm' || !currentDm) {
      setDmMessages([]);
      setDmTyping({});
      return undefined;
    }
    send({ op: 'focus' }); // clear any channel focus
    send({ op: 'dm_focus', with: currentDm });
    let cancelled = false;
    api
      .getDmMessages(currentDm)
      .then((msgs) => {
        if (cancelled) return;
        setDmMessages(msgs);
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id || 0), 0);
        send({ op: 'dm_read', with: currentDm, lastId: maxId });
        setDmUnread((prev) => {
          if (!prev[currentDm]) return prev;
          const next = { ...prev };
          delete next[currentDm];
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, currentDm, status, send]);

  // Load members on server switch and when the gateway (re)connects.
  useEffect(() => {
    if (!currentSpace) {
      setMembers([]);
      return;
    }
    refreshMembers(currentSpace);
  }, [currentSpace, status]);

  // Expire typing indicators a few seconds after the last keystroke event.
  useEffect(() => {
    const prune = (prev) => {
      const now = Date.now();
      const next = {};
      let changed = false;
      for (const [u, exp] of Object.entries(prev)) {
        if (exp > now) next[u] = exp;
        else changed = true;
      }
      return changed ? next : prev;
    };
    const iv = setInterval(() => {
      setTypingUsers(prune);
      setDmTyping(prune);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ---- Actions ----
  function logout() {
    if (voiceRef.current) voiceRef.current.leave();
    setVoiceStates({});
    api.clearToken();
    setToken('');
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    setMessages([]);
    setMembers([]);
    setProfile(null);
    setUnread({});
    setMentions({});
    setView('server');
    setDms([]);
    setCurrentDm('');
    setDmMessages([]);
    setDmUnread({});
  }

  function selectSpace(name) {
    setView('server');
    setCurrentSpace(name);
    const s = spaces.find((x) => x.name === name);
    setCurrentChannel(s && s.channels[0] ? s.channels[0] : '');
  }

  function openDms() {
    setView('dm');
    loadDms();
  }

  function selectDm(username) {
    setView('dm');
    setCurrentDm(username);
  }

  function startDm(username) {
    if (!username || username === user) return;
    setView('dm');
    setCurrentDm(username);
    setDms((prev) => (prev.find((d) => d.username === username) ? prev : [{ username, unread: 0 }, ...prev]));
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

  const sendDm = (content, attachment, spoiler) => {
    if (currentDm) send({ op: 'dm', to: currentDm, content, attachment, spoiler });
  };
  const sendDmTyping = () => {
    if (currentDm) send({ op: 'dm_typing', with: currentDm });
  };

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

  const sendMessage = (content, attachment, spoiler) =>
    send({ op: 'message', space: currentSpace, channel: currentChannel, content, attachment, spoiler });
  const editMessage = (id, content) => send({ op: 'edit', id, content });
  const deleteMessage = (id) => send({ op: 'delete', id });
  const reactToMessage = (id, emoji) => send({ op: 'react', id, emoji });
  const sendTyping = () => send({ op: 'typing', space: currentSpace, channel: currentChannel });

  const typingNames = Object.keys(typingUsers).filter((u) => u !== user);

  // Unread + mention badges: per-channel (for the current server) and per-server totals.
  const channelUnread = {};
  const channelMentions = {};
  for (const c of channels) {
    const n = unread[unreadKey(currentSpace, c)];
    if (n) channelUnread[c] = n;
    const mn = mentions[unreadKey(currentSpace, c)];
    if (mn) channelMentions[c] = mn;
  }
  const spaceUnread = {};
  const spaceMentions = {};
  for (const s of spaces) {
    let total = 0;
    let mtotal = 0;
    for (const c of s.channels) {
      total += unread[unreadKey(s.name, c)] || 0;
      mtotal += mentions[unreadKey(s.name, c)] || 0;
    }
    if (total) spaceUnread[s.name] = total;
    if (mtotal) spaceMentions[s.name] = mtotal;
  }
  const memberNames = members.map((m) => m.username);
  const totalDmUnread = Object.values(dmUnread).reduce((a, b) => a + b, 0);
  const dmTypingNames = Object.keys(dmTyping);

  const voiceChannels = activeSpace ? activeSpace.voiceChannels || [] : [];
  const voiceParticipantsByChannel = {};
  for (const vc of voiceChannels) {
    voiceParticipantsByChannel[vc] = voiceStates[unreadKey(currentSpace, vc)] || [];
  }

  if (!token) return <Login onAuthed={setToken} />;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerRail
        spaces={spaces}
        currentSpace={view === 'server' ? currentSpace : ''}
        unread={spaceUnread}
        mentions={spaceMentions}
        dmActive={view === 'dm'}
        dmUnread={totalDmUnread}
        onSelectDms={openDms}
        onSelect={selectSpace}
        onCreate={createSpace}
        onJoin={joinServer}
      />

      {view === 'dm' ? (
        <>
          <DmSidebar
            conversations={dms}
            currentDm={currentDm}
            unread={dmUnread}
            onSelect={selectDm}
            user={user}
            avatar={profile?.avatar}
            status={status}
            onOpenProfile={() => setProfileOpen(true)}
            onLogout={logout}
          />
          <DmPanel
            username={currentDm}
            messages={dmMessages}
            currentUser={user}
            typing={dmTypingNames}
            onSend={sendDm}
            onTyping={sendDmTyping}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </>
      ) : (
        <>
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
            onJoinVoice={joinVoice}
            onLeaveVoice={leaveVoice}
            onToggleMute={toggleMute}
            onToggleDeafen={toggleDeafen}
            onToggleShare={toggleShareAudio}
            onSelect={setCurrentChannel}
            onCreateChannel={createChannel}
            canManage={canManage}
            isOwner={role === 'owner'}
            onInvite={makeInvite}
            onDeleteServer={deleteServer}
            user={user}
            avatar={profile?.avatar}
            onOpenProfile={() => setProfileOpen(true)}
            status={status}
            onLogout={logout}
          />
          <ChatPanel
            space={currentSpace}
            channel={currentChannel}
            status={status}
            messages={messages}
            currentUser={user}
            typingUsers={typingNames}
            memberNames={memberNames}
            onSend={sendMessage}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onReact={reactToMessage}
            onTyping={sendTyping}
            onOpenSearch={() => setSearchOpen(true)}
          />
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
      {loadError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  );
}
