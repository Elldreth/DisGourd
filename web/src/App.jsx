import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { useGateway } from './useSocket.js';
import { mergeMessages } from './util.js';
import Login from './components/Login.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelList from './components/ChannelList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import MemberList from './components/MemberList.jsx';
import InviteDialog from './components/InviteDialog.jsx';
import ProfileDialog from './components/ProfileDialog.jsx';

export default function App() {
  const [token, setToken] = useState(api.getToken());
  const user = useMemo(() => {
    const p = api.decodeToken(token);
    return p ? p.name || p.username || p.sub : '';
  }, [token]);

  const [spaces, setSpaces] = useState([]);
  const [currentSpace, setCurrentSpace] = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [profile, setProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Refs so gateway handlers (created once) can read the latest selection.
  const spaceRef = useRef(currentSpace);
  spaceRef.current = currentSpace;
  const channelRef = useRef(currentChannel);
  channelRef.current = currentChannel;

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
        if (m.space === spaceRef.current && m.channel === channelRef.current) {
          setMessages((prev) => mergeMessages(prev, [m]));
        }
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
      members_changed: (f) => {
        if (f.space === spaceRef.current) refreshMembers(f.space);
      },
    }),
    []
  );

  const { status, send } = useGateway({ token, handlers });

  // Clear the transcript immediately when switching channels.
  useEffect(() => {
    setMessages([]);
    setTypingUsers({});
  }, [currentSpace, currentChannel]);

  // Focus the active channel and (re)load its history — also on reconnect.
  useEffect(() => {
    if (!currentSpace || !currentChannel) return undefined;
    send({ op: 'focus', space: currentSpace, channel: currentChannel });
    let cancelled = false;
    api
      .getMessages(currentSpace, currentChannel)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSpace, currentChannel, status, send]);

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
    const iv = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = {};
        let changed = false;
        for (const [u, exp] of Object.entries(prev)) {
          if (exp > now) next[u] = exp;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ---- Actions ----
  function logout() {
    api.clearToken();
    setToken('');
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    setMessages([]);
    setMembers([]);
    setProfile(null);
  }

  function selectSpace(name) {
    setCurrentSpace(name);
    const s = spaces.find((x) => x.name === name);
    setCurrentChannel(s && s.channels[0] ? s.channels[0] : '');
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

  async function createChannel(name) {
    if (!currentSpace) return;
    try {
      const created = await api.createChannel(currentSpace, name);
      const next = await loadSpaces();
      const s = next.find((x) => x.name === currentSpace);
      if (s && created.name && s.channels.includes(created.name)) setCurrentChannel(created.name);
    } catch (err) {
      setLoadError(err.message || 'Could not create channel');
    }
  }

  async function makeInvite() {
    try {
      const res = await api.createInvite(currentSpace);
      setInviteCode(res.code);
    } catch (err) {
      setLoadError(err.message || 'Could not create invite');
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

  const sendMessage = (content, attachment) =>
    send({ op: 'message', space: currentSpace, channel: currentChannel, content, attachment });
  const editMessage = (id, content) => send({ op: 'edit', id, content });
  const deleteMessage = (id) => send({ op: 'delete', id });
  const reactToMessage = (id, emoji) => send({ op: 'react', id, emoji });
  const sendTyping = () => send({ op: 'typing', space: currentSpace, channel: currentChannel });

  const typingNames = Object.keys(typingUsers).filter((u) => u !== user);

  if (!token) return <Login onAuthed={setToken} />;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerRail
        spaces={spaces}
        currentSpace={currentSpace}
        onSelect={selectSpace}
        onCreate={createSpace}
        onJoin={joinServer}
      />
      <ChannelList
        space={currentSpace}
        channels={channels}
        currentChannel={currentChannel}
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
        onSend={sendMessage}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onReact={reactToMessage}
        onTyping={sendTyping}
      />
      <MemberList members={members} />

      {inviteCode && (
        <InviteDialog space={currentSpace} code={inviteCode} onClose={() => setInviteCode(null)} />
      )}
      {profileOpen && profile && (
        <ProfileDialog profile={profile} onClose={() => setProfileOpen(false)} onUpdated={setProfile} />
      )}
      {loadError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  );
}
