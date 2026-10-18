import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';
import {
  OWNER_POSITION,
  loadViewState,
  saveViewState,
  loadServerOrder,
  saveServerOrder,
  applyServerOrder,
} from '../util.js';

// Servers ("spaces") and navigation: the server list and rail order, the open
// server and channel, its members, permissions derived from your role, the
// server/channel/member actions, the gateway handlers that keep them current,
// and saving/restoring what you were looking at.
//   view / dmCurrent: what's showing, for save/restore
//   onRestoreDm(name): reopen a saved DM after sign-in
export function useSpaces({ token, myId, status, reconnects = 0, view, dmCurrent, onRestoreDm }) {
  const [spaces, setSpaces] = useState([]);
  const [serverOrder, setServerOrder] = useState([]); // user's custom rail order
  const [currentSpace, setCurrentSpace] = useState('');
  const [currentChannel, setCurrentChannel] = useState('');
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]); // the current server's roles, highest first
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState(null);
  const [iconCrop, setIconCrop] = useState(null); // { src: File|url, initialCrop } while framing a server icon

  // Handlers run outside render, so they read the latest selection from refs.
  const spaceRef = useRef(currentSpace);
  spaceRef.current = currentSpace;
  const channelRef = useRef(currentChannel);
  channelRef.current = currentChannel;

  // ---- Derived ----
  const orderedSpaces = useMemo(() => applyServerOrder(spaces, serverOrder), [spaces, serverOrder]);
  const activeSpace = spaces.find((s) => s.name === currentSpace);
  const channels = activeSpace ? activeSpace.channels : [];
  const voiceChannels = activeSpace ? activeSpace.voiceChannels || [] : [];
  const role = activeSpace ? activeSpace.role : null;
  // What the server says I may do here (my roles' abilities; the owner can do
  // everything). The server checks too; these only decide what to offer.
  const abilities = activeSpace?.abilities || [];
  const can = (action) => !!activeSpace?.owner || abilities.includes(action);
  const canManage = can('edit_server');
  const myPosition = activeSpace?.owner ? OWNER_POSITION : activeSpace?.position ?? 0;
  const channelMeta = activeSpace ? activeSpace.channelMeta || {} : {};
  const canPostCurrent = channelMeta[currentChannel]?.canPost ?? true;
  // Whether I may delete someone else's message: I hold "delete others'
  // messages" and the author sits strictly below me (people who left sit
  // below everyone). Mirrors the server check, which has the final say.
  const canModerate = can('delete_others_messages')
    ? (author) => (members.find((mb) => mb.username === author)?.position ?? -1) < myPosition
    : null;

  // Whether I may pin and unpin messages here, manage emoji, or remove members.
  const canPin = can('pin_messages');
  const canManageEmoji = can('manage_emoji');
  const canKick = can('kick');
  const canManageRoles = can('manage_roles');

  async function loadSpaces() {
    try {
      const next = await api.getSpaces();
      setSpaces(next);
      setError('');
      return next;
    } catch (err) {
      setError(err.message || 'Could not reach the server');
      return [];
    }
  }

  function refreshMembers(space) {
    if (!space) return;
    api.getMembers(space).then((r) => setMembers(r.members || [])).catch(() => {});
    api.getRoles(space).then((r) => setRoles(r.roles || [])).catch(() => {});
  }

  // Open a server at a channel (default: its first).
  function goTo(name, list, channel) {
    const s = list.find((x) => x.name === name);
    setCurrentSpace(name);
    setCurrentChannel(channel ?? (s && s.channels[0] ? s.channels[0] : ''));
  }
  const goToFirst = (list) => {
    const first = list[0];
    setCurrentSpace(first ? first.name : '');
    setCurrentChannel(first && first.channels[0] ? first.channels[0] : '');
  };

  // Initial load after auth. Restore whatever the user was last looking at.
  useEffect(() => {
    if (!token) return;
    loadSpaces().then((next) => {
      if (spaceRef.current) return; // already positioned (e.g. arrived via invite)
      const saved = loadViewState(myId);
      if (saved && saved.view === 'dm' && saved.dm) {
        onRestoreDm(saved.dm);
        return;
      }
      if (saved && saved.space) {
        const s = next.find((x) => x.name === saved.space);
        if (s) {
          goTo(saved.space, next, s.channels.includes(saved.channel) ? saved.channel : undefined);
          return;
        }
      }
      if (next.length) goToFirst(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load the saved rail order once we know who's signed in.
  useEffect(() => {
    if (myId) setServerOrder(loadServerOrder(myId));
  }, [myId]);

  // Persist the current view so a refresh returns you to the same place.
  useEffect(() => {
    if (!token || !myId) return;
    if (view === 'server' && !currentSpace) return; // don't clobber saved state with the empty first render
    saveViewState(myId, { view, space: currentSpace, channel: currentChannel, dm: dmCurrent });
  }, [token, myId, view, currentSpace, currentChannel, dmCurrent]);

  // If the current channel becomes hidden to us (permissions changed), fall back
  // to the first channel we can still see.
  useEffect(() => {
    if (view === 'server' && currentChannel && channels.length && !channels.includes(currentChannel)) {
      setCurrentChannel(channels[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, currentChannel, view]);

  // After a reconnect, reload the server list: channels or servers may have
  // been created, deleted or hidden from you while you were away. A deleted
  // or hidden channel falls back via the effect above; a server you're no
  // longer in sends you to the first one. (An empty list means the request
  // failed, so leave things as they are.)
  useEffect(() => {
    if (!reconnects) return;
    loadSpaces().then((next) => {
      if (next.length && spaceRef.current && !next.some((s) => s.name === spaceRef.current)) goToFirst(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnects]);

  // Load members on server switch and when the gateway (re)connects.
  useEffect(() => {
    if (!currentSpace) {
      setMembers([]);
      setRoles([]);
      return;
    }
    refreshMembers(currentSpace);
  }, [currentSpace, status]);

  const handlers = {
    presence: (p) => {
      // status: online | idle | dnd | offline (an invisible member reads as offline)
      setMembers((prev) =>
        prev.map((m) =>
          m.username === p.user
            ? { ...m, status: p.status, online: p.status !== 'offline', statusText: p.statusText ?? null, statusEmoji: p.statusEmoji ?? null }
            : m
        )
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
        if (spaceRef.current === f.space) goToFirst(next);
      });
    },
    space_left: (f) => {
      // You were removed from a server, or left it.
      loadSpaces().then((next) => {
        if (spaceRef.current === f.space) goToFirst(next);
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
  };

  // Run an API action, showing `failure` (or the server's message) on error.
  const attempt = (failure, fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      setError(err.message || failure);
    }
  };

  const actions = {
    selectSpace: (name) => goTo(name, spaces),
    selectChannel: setCurrentChannel,
    openChannel: (space, channel) => {
      setCurrentSpace(space);
      setCurrentChannel(channel);
    },
    reorder: (names) => {
      setServerOrder(names);
      saveServerOrder(myId, names);
    },
    // These two throw, so the Add a server dialog can show the error inline.
    // icon (optional): { original: File, blob, crop } from the cropper. It's set
    // after the server exists; if only that part fails, the server is kept and
    // the error says so (retrying the create would hit "name already exists").
    createSpace: async (name, { template, icon } = {}) => {
      await api.createSpace(name, template);
      if (icon) {
        try {
          const original = await api.uploadFile(icon.original);
          const framed = await api.uploadFile(icon.blob);
          await api.setSpaceIcon(name, framed.url, original.url, icon.crop);
        } catch {
          setError('The server was created, but its icon could not be saved. Set it from the server menu.');
        }
      }
      await loadSpaces();
      setCurrentSpace(name);
      setCurrentChannel('general');
    },
    joinServer: async (code) => {
      const res = await api.joinInvite(code.trim());
      const next = await loadSpaces();
      const s = next.find((x) => x.name === res.name);
      goTo(res.name, next, s && s.channels[0] ? s.channels[0] : 'general');
    },
    createChannel: attempt('Could not create channel', async (name, type = 'text') => {
      if (!currentSpace) return;
      const created = await api.createChannel(currentSpace, name, type);
      const next = await loadSpaces();
      const s = next.find((x) => x.name === currentSpace);
      if (type === 'text' && s && created.name && s.channels.includes(created.name)) {
        setCurrentChannel(created.name);
      }
    }),
    makeInvite: attempt('Could not create invite', async () => {
      const res = await api.createInvite(currentSpace);
      setInviteCode(res.code);
    }),
    closeInvite: () => setInviteCode(null),
    // Give (on) or take a role; the gateway's members_changed refreshes everyone.
    setMemberHasRole: attempt('Could not change roles', async (username, roleId, on) => {
      await api.setMemberHasRole(currentSpace, username, roleId, on);
      refreshMembers(currentSpace);
    }),
    reloadRoles: () => refreshMembers(spaceRef.current),
    kickMember: attempt('Could not remove member', async (username) => {
      await api.kickMember(currentSpace, username);
      refreshMembers(currentSpace);
    }),
    deleteServer: attempt('Could not delete server', async () => {
      if (!currentSpace) return;
      await api.deleteSpace(currentSpace);
      // The gateway also broadcasts space_deleted; refresh proactively.
      goToFirst(await loadSpaces());
    }),
    changeServerIcon: (file) => {
      if (!currentSpace || !file) return;
      if (!file.type.startsWith('image/')) {
        setError('Please choose an image file for the server icon');
        return;
      }
      setIconCrop({ src: file, initialCrop: null }); // frame it before uploading
    },
    reframeServerIcon: () => {
      if (!activeSpace?.iconOriginal) return;
      setIconCrop({ src: activeSpace.iconOriginal, initialCrop: activeSpace.iconCrop || null });
    },
    cancelIconCrop: () => setIconCrop(null),
    saveServerIcon: attempt('Could not update the server icon', async ({ blob, crop }) => {
      if (!currentSpace || !iconCrop) return;
      // Keep the original so the icon can be re-framed later without re-uploading.
      const original = typeof iconCrop.src === 'string' ? iconCrop.src : (await api.uploadFile(iconCrop.src)).url;
      const up = await api.uploadFile(blob);
      await api.setSpaceIcon(currentSpace, up.url, original, crop);
      await loadSpaces();
      setIconCrop(null);
    }),
    removeServerIcon: attempt('Could not remove the server icon', async () => {
      if (!currentSpace) return;
      await api.setSpaceIcon(currentSpace, '');
      await loadSpaces();
    }),
    renameServer: attempt('Could not rename the server', async (newName) => {
      const trimmed = (newName || '').trim();
      if (!currentSpace || !trimmed || trimmed === currentSpace) return;
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
    }),
    reloadSpaces: loadSpaces,
  };

  // Forget everything (on logout).
  function reset() {
    setSpaces([]);
    setCurrentSpace('');
    setCurrentChannel('');
    setMembers([]);
  }

  return {
    spaces,
    orderedSpaces,
    currentSpace,
    currentChannel,
    activeSpace,
    channels,
    voiceChannels,
    channelMeta,
    role,
    canManage,
    canPostCurrent,
    canModerate,
    canPin,
    canManageEmoji,
    canKick,
    canManageRoles,
    myPosition,
    members,
    roles,
    memberNames: members.map((m) => m.username),
    error,
    inviteCode,
    iconCrop,
    handlers,
    reset,
    ...actions,
  };
}
