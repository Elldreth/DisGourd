import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from './api.js';
import { useChannelSocket } from './useSocket.js';
import { mergeMessages } from './util.js';
import Login from './components/Login.jsx';
import ServerRail from './components/ServerRail.jsx';
import ChannelList from './components/ChannelList.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import MemberList from './components/MemberList.jsx';

// Convert the backend's /admin/state map into an ordered array of spaces.
function toSpaces(state) {
  return Object.entries(state || {}).map(([name, s]) => ({
    name,
    channels: Object.keys(s.channels || {}),
  }));
}

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
  const [friends, setFriends] = useState([]);
  const [loadError, setLoadError] = useState('');

  const activeSpace = spaces.find((s) => s.name === currentSpace);
  const channels = activeSpace ? activeSpace.channels : [];

  // ---- Load the space/channel tree after auth ----
  const loadState = useCallback(async () => {
    try {
      const state = await api.getState();
      const next = toSpaces(state);
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
    loadState().then((next) => {
      if (next.length && !currentSpace) {
        setCurrentSpace(next[0].name);
        setCurrentChannel(next[0].channels[0] || '');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Reset the visible transcript whenever we move to a different channel; the
  // socket re-opens and repopulates history for the new channel.
  useEffect(() => {
    setMessages([]);
  }, [currentSpace, currentChannel]);

  // ---- Realtime socket for the active channel ----
  const handlers = useMemo(
    () => ({
      onHistory: (msgs) => setMessages((prev) => mergeMessages(prev, msgs)),
      onMessage: (m) => setMessages((prev) => mergeMessages(prev, [m])),
      onFriendList: (list) => setFriends(list),
      onPresence: (p) =>
        setFriends((prev) =>
          prev.map((f) => (f.username === p.user ? { ...f, online: p.status === 'online' } : f))
        ),
    }),
    []
  );

  const { status, send } = useChannelSocket({
    space: currentSpace,
    channel: currentChannel,
    token,
    handlers,
  });

  // ---- Actions ----
  function handleAuthed(newToken) {
    setTokenState(newToken);
  }

  function logout() {
    api.clearToken();
    setTokenState('');
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    setMessages([]);
    setFriends([]);
  }

  function selectSpace(name) {
    setCurrentSpace(name);
    const s = spaces.find((x) => x.name === name);
    setCurrentChannel(s && s.channels[0] ? s.channels[0] : '');
  }

  async function createSpace(name) {
    try {
      await api.createSpace(name);
      // New servers start with a #general channel.
      await api.createChannel(name, 'general');
      await loadState();
      setCurrentSpace(name);
      setCurrentChannel('general');
    } catch (err) {
      setLoadError(err.message || 'Could not create server');
    }
  }

  async function createChannel(name) {
    if (!currentSpace) return;
    try {
      await api.createChannel(currentSpace, name);
      const next = await loadState();
      const s = next.find((x) => x.name === currentSpace);
      if (s && s.channels.includes(name)) setCurrentChannel(name);
    } catch (err) {
      setLoadError(err.message || 'Could not create channel');
    }
  }

  function sendMessage(content, attachment) {
    send({ content, attachment });
  }

  if (!token) return <Login onAuthed={handleAuthed} />;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerRail
        spaces={spaces}
        currentSpace={currentSpace}
        onSelect={selectSpace}
        onCreate={createSpace}
      />
      <ChannelList
        space={currentSpace}
        channels={channels}
        currentChannel={currentChannel}
        onSelect={setCurrentChannel}
        onCreateChannel={createChannel}
        user={user}
        status={currentChannel ? status : 'idle'}
        onLogout={logout}
      />
      <ChatPanel
        space={currentSpace}
        channel={currentChannel}
        status={status}
        messages={messages}
        onSend={sendMessage}
      />
      <MemberList friends={friends} />

      {loadError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white shadow-lg">
          {loadError}
        </div>
      )}
    </div>
  );
}
