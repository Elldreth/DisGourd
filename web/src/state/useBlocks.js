import { createContext, useContext, useEffect, useState } from 'react';
import * as api from '../api.js';

// Blocking (P9-07b): the people I've blocked, loaded after sign-in and again
// when the server says it changed (`blocks_changed`: another of my tabs) or
// after a reconnect. `block` / `unblock` act at once and reload.
export function useBlocks({ token, reconnects = 0 }) {
  const [list, setList] = useState([]); // [{ id, username, avatar, since }]
  function load() {
    api.getBlocks().then((rows) => setList(Array.isArray(rows) ? rows : [])).catch(() => {});
  }
  useEffect(() => {
    if (token) load();
    else setList([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reconnects]);
  const names = new Set(list.map((u) => u.username));
  return {
    list,
    isBlocked: (username) => !!username && names.has(username),
    block: (username) => api.blockUser(username).then(load),
    unblock: (username) => api.unblockUser(username).then(load),
    handlers: { blocks_changed: load },
  };
}

// What the rest of the app reads: whether someone is blocked, asking to block
// (App shows the "are you sure?"), and unblocking. Outside a provider (tests,
// screens before sign-in) nobody is blocked and the actions do nothing.
const NONE = { list: [], isBlocked: () => false, requestBlock: null, unblock: null };
export const BlocksContext = createContext(NONE);
export const useBlocked = () => useContext(BlocksContext);
