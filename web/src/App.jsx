import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from './api.js';
import { useChannelSocket } from './useSocket.js';
import { mergeMessages } from './util.js';
import Login from './components/Login.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelList from './components/ChannelList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import MemberList from './components/MemberList.jsx';
import InviteDialog from './components/InviteDialog.jsx';

export default function App() {
  const [token, setTokenState] = useState(api.getToken());
  const user = useMemo(() => {
    const p = api.decodeToken(token);
    return p ? p.name || p.username || p.sub : '';
  }, [token]);

  const [spaces, setSpaces] = useState([]);
  const [currentSpace, setCurrentSpace] = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState(null); // shown in the invite dialog
  const [typingUsers, setTypingUsers] = useState({}); // username -> expires-at ms
  const [loadError, setLoadError] = useState('');

  const activeSpace = spaces.find((s) => s.name === currentSpace);
  const channels = activeSpace ? activeSpace.channels : [];
  const role = activeSpace ? activeSpace.role : null;
  const canManage = role === 'owner' || role === 'admin';

  // ---- Load the servers the user belongs to ----
  const loadSpaces = useCallback(async () => {
    try {
      const next = await api.getSpaces();
      setSpaces(next);
      setLoadError('');
      return next;
    } catch (err) {
      setLoadError(err.message || 'Could not reach the server');
      return [];
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    loadSpaces().then((next) => {
      if (next.length && !currentSpace) {
        setCurrentSpace(next[0].name);
        setCurrentChannel(next[0].channels[0] || '');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Reset the transcript and typing state when moving to a different channel;
  // the socket re-opens and repopulates history.
  useEffect(() => {
    setMessages([]);
    setTypingUsers({});
  }, [currentSpace, currentChannel]);

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

  // ---- Realtime socket for the active channel ----
  const handlers = useMemo(
    () => ({
      onHistory: (msgs) => setMessages((prev) => mergeMessages(prev, msgs)),
      onMessage: (m) => setMessages((prev) => mergeMessages(prev, [m])),
      onMessageUpdate: (u) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === u.id ? { ...m, content: u.content, editedAt: u.editedAt } : m))
        ),
      onMessageDelete: (d) => setMessages((prev) => prev.filter((m) => m.id !== d.id)),
      onReaction: (r) =>
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== r.id) return m;
            const others = (m.reactions || []).filter((x) => x.emoji !== r.emoji);
            const next = r.count > 0 ? [...others, { emoji: r.emoji, count: r.count, users: r.users }] : others;
            return { ...m, reactions: next };
          })
        ),
      onTyping: (t) => setTypingUsers((prev) => ({ ...prev, [t.user]: Date.now() + 4000 })),
    }),
    []
  );

  const { status, send } = useChannelSocket({
    space: currentSpace,
    channel: currentChannel,
    token,
    handlers,
  });

  // Load the member list for the active server, refreshed when the socket
  // (re)connects so presence stays reasonably fresh.
  useEffect(() => {
    if (!currentSpace) {
      setMembers([]);
      return undefined;
    }
    let cancelled = false;
    api
      .getMembers(currentSpace)
      .then((r) => {
        if (!cancelled) setMembers(r.members || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSpace, status]);

  // ---- Actions ----
  function logout() {
    api.clearToken();
    setTokenState('');
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    setMessages([]);
    setMembers([]);
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
      const next = await loadSpaces();
      const first = next[0];
      setCurrentSpace(first ? first.name : '');
      setCurrentChannel(first && first.channels[0] ? first.channels[0] : '');
    } catch (err) {
      setLoadError(err.message || 'Could not delete server');
    }
  }

  function sendMessage(content, attachment) {
    send({ content, attachment });
  }
  function editMessage(id, content) {
    send({ type: 'edit', id, content });
  }
  function deleteMessage(id) {
    send({ type: 'delete', id });
  }
  function reactToMessage(id, emoji) {
    send({ type: 'react', id, emoji });
  }
  function sendTyping() {
    send({ type: 'typing' });
  }

  const typingNames = Object.keys(typingUsers).filter((u) => u !== user);

  if (!token) return <Login onAuthed={setTokenState} />;

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
        status={currentChannel ? status : 'idle'}
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

      {loadError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  );
}
