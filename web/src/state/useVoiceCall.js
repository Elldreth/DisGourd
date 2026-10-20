import { useEffect, useRef, useState } from 'react';
import { createVoiceController } from '../voice.js';
import { getPttEnabled, getPttKey } from '../audio.js';
import { unreadKey } from './useChannelMessages.js';

const IDLE_CALL = {
  room: null, status: 'idle', muted: false, deafened: false, pttEnabled: false, micError: false,
  unstable: false, sharing: false, shareError: '', cameraOn: false, screenOn: false, videoError: '',
  videos: [], participants: [], notice: '',
};

// Voice and video calls (a WebRTC mesh via voice.js): your own call's state,
// who is in each voice channel, the keyboard shortcuts, the voice_* gateway
// handlers and the call actions.
export function useVoiceCall({ send, myId }) {
  const [call, setCall] = useState(IDLE_CALL);
  const [states, setStates] = useState({}); // unreadKey(space, channel) -> participants[]
  const voiceRef = useRef(null);

  // The controller is recreated per session; it tears down its call when the
  // user (or the session) changes.
  useEffect(() => {
    voiceRef.current = createVoiceController({ send, myId, onChange: setCall });
    return () => voiceRef.current && voiceRef.current.leave();
  }, [myId, send]);

  const v = () => voiceRef.current;

  const handlers = {
    // Every connect starts with `ready`, followed by a voice_state for each
    // occupied room. Forget what we knew first, so rooms that emptied while
    // we were offline don't keep showing people.
    // If we were in a call, the server dropped us from it when the old socket
    // closed: join it again.
    ready: () => {
      setStates({});
      v() && v().rejoin();
    },
    voice_state: (f) => {
      setStates((prev) => ({ ...prev, [unreadKey(f.space, f.channel)]: f.participants || [] }));
      v() && v().handleState(f);
    },
    voice_peers: (f) => {
      if (!v()) return;
      v().handlePeers(f.peers || []);
      v().setForcedMute(!!f.forcedMute); // timed out here (P3-26c)
    },
    voice_forced_mute: (f) => {
      if (v() && call.room && call.room.space === f.space) v().setForcedMute(f.on);
    },
    // Removed or banned from the call's server: the server already dropped us.
    voice_ended: (f) => {
      const why = f.reason === 'banned' ? 'you were banned from' : f.reason === 'left' ? 'you left' : 'you were removed from';
      v() && v().endCall(`Your call in #${f.channel} ended: ${why} ${f.space}.`);
    },
    // A voice channel was renamed (P6-03): the server kept the room; follow it.
    channel_renamed: (f) => {
      v() && v().renameRoom(f.space, f.channel, f.newName);
      setStates((prev) => {
        const from = unreadKey(f.space, f.channel);
        if (!(from in prev)) return prev;
        const { [from]: people, ...rest } = prev;
        return { ...rest, [unreadKey(f.space, f.newName)]: people };
      });
    },
    voice_peer_joined: (f) => v() && v().handlePeerJoined(f.peer),
    voice_peer_left: (f) => v() && v().handlePeerLeft(f.userId),
    voice_signal: (f) => v() && v().handleSignal(f.from, f.data),
  };

  const actions = {
    join: (space, channel) => {
      if (call.room && call.room.space === space && call.room.channel === channel) return;
      v() && v().join(space, channel);
    },
    leave: () => v() && v().leave(),
    toggleMute: () => v() && v().toggleMute(),
    toggleDeafen: () => v() && v().toggleDeafen(),
    refreshPtt: () => v() && v().refreshPtt(),
    switchMic: () => v() && v().switchMic(),
    applyOutput: () => v() && v().applyOutput(),
    toggleShare: () => v() && v().toggleShare(),
    toggleShareMute: (userId) => v() && v().toggleShareMute(userId),
    setShareVolume: (userId, vol) => v() && v().setShareVolume(userId, vol),
    toggleCamera: () => v() && v().toggleCamera(),
    toggleScreen: () => v() && v().toggleScreen(),
    dismissNotice: () => v() && v().clearNotice(),
  };

  // Keyboard shortcuts, active only while in a call. Browsers only deliver these
  // while the DisGourd window is focused (no true global hotkeys without a
  // desktop wrapper). Mute/deafen use modifiers so they're safe even while
  // typing; push-to-talk is ignored while a text field is focused.
  useEffect(() => {
    if (!call.room) return undefined;
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        if (e.code === 'KeyM') { e.preventDefault(); v() && v().toggleMute(); return; }
        if (e.code === 'KeyD') { e.preventDefault(); v() && v().toggleDeafen(); return; }
      }
      if (getPttEnabled() && getPttKey() && e.code === getPttKey() && !e.repeat && !isTyping()) {
        e.preventDefault();
        v() && v().setPttActive(true);
      }
    };
    const onKeyUp = (e) => {
      if (getPttEnabled() && e.code === getPttKey() && v()) v().setPttActive(false);
    };
    const releasePtt = () => v() && v().setPttActive(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releasePtt);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releasePtt);
    };
  }, [call.room]);

  // Leave any call and forget who's where (on logout).
  function reset() {
    v() && v().leave();
    setStates({});
  }

  // Participants per voice channel of one server, for the channel list.
  function participantsFor(space, voiceChannels) {
    const out = {};
    for (const vc of voiceChannels) out[vc] = states[unreadKey(space, vc)] || [];
    return out;
  }

  return { call, handlers, ...actions, reset, participantsFor };
}
