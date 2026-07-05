// Mesh WebRTC voice controller. There is NO media server — peers connect
// directly to each other and the gateway only relays signaling (SDP + ICE).
// onChange(state) pushes updates to React. Great for small friend-group calls.
//
// STUN handles most NATs; for tricky networks add a TURN server by setting
// window.__DISGOURD_ICE__ (an array of RTCIceServer objects) before load.
import {
  audioConstraints,
  getPreferredInput,
  getPreferredOutput,
  getPttEnabled,
  getVoiceSounds,
} from './audio.js';
import { playSelfJoin, playSelfLeave, playPeerJoin, playPeerLeave } from './sounds.js';

const ICE_SERVERS =
  (typeof window !== 'undefined' && window.__DISGOURD_ICE__) || [
    { urls: 'stun:stun.l.google.com:19302' },
  ];

export function createVoiceController({ send, myId, onChange }) {
  let room = null; // { space, channel }
  let status = 'idle'; // idle | connecting | connected
  let muted = false;
  let deafened = false; // silence everyone else (also forces self-mute)
  let mutedBeforeDeafen = false; // restore this mute state when un-deafening
  let pttActive = false; // push-to-talk key currently held
  let micError = false; // joined but couldn't get a microphone (listen-only)
  let localStream = null;
  let participants = []; // authoritative list from the server (voice_state)
  let knownIds = null; // Set of participant userIds, for join/leave chimes
  const pcs = new Map(); // userId -> RTCPeerConnection
  const audioEls = new Map(); // userId -> HTMLAudioElement
  const analysers = new Map(); // userId -> { analyser, data }
  const speaking = new Set(); // userIds currently speaking
  let audioCtx = null;
  let speakTimer = null;

  function emit() {
    onChange({
      room,
      status,
      muted,
      deafened,
      pttEnabled: getPttEnabled(),
      micError,
      participants: participants.map((p) => ({ ...p, speaking: speaking.has(p.userId) })),
    });
  }

  // Whether the local mic should currently send audio, given mute, deafen and
  // push-to-talk state.
  function micShouldTransmit() {
    if (!localStream || muted || deafened) return false;
    if (getPttEnabled()) return pttActive;
    return true;
  }

  // Apply the transmit decision to the outgoing audio tracks.
  function applyMic() {
    if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = micShouldTransmit()));
  }

  // Mute/unmute remote audio elements when deafened.
  function applyDeafen() {
    audioEls.forEach((el) => {
      el.muted = deafened;
    });
  }

  function setupAnalyser(userId, stream) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      analysers.set(userId, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
    } catch {
      /* speaking detection is best-effort */
    }
  }

  function pollSpeaking() {
    let changed = false;
    for (const [userId, { analyser, data }] of analysers) {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const level = sum / data.length;
      // Don't show ourselves as speaking when we aren't actually transmitting.
      const active = level > 12 && !(userId === myId && !micShouldTransmit());
      if (active !== speaking.has(userId)) {
        if (active) speaking.add(userId);
        else speaking.delete(userId);
        changed = true;
      }
    }
    if (changed) emit();
  }

  // Open the preferred microphone, falling back to the system default if that
  // specific device is unavailable.
  async function getMicStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
    } catch (err) {
      if (getPreferredInput()) {
        return navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }

  function applySink(el) {
    const out = getPreferredOutput();
    if (out && typeof el.setSinkId === 'function') el.setSinkId(out).catch(() => {});
  }

  // Re-route all remote audio to the preferred speaker (call after the user
  // changes their output device while in a call).
  function applyOutput() {
    audioEls.forEach((el) => applySink(el));
  }

  function newPeer(userId, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    } else if (initiator) {
      // No mic: still negotiate a receive-only audio line so we can hear others.
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ op: 'voice_signal', to: userId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      let el = audioEls.get(userId);
      if (!el) {
        el = new Audio();
        el.autoplay = true;
        audioEls.set(userId, el);
      }
      el.srcObject = e.streams[0];
      el.muted = deafened;
      applySink(el);
      const p = el.play?.();
      if (p) p.catch(() => {});
      setupAnalyser(userId, e.streams[0]);
    };
    pcs.set(userId, pc);
    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => send({ op: 'voice_signal', to: userId, data: { sdp: pc.localDescription } }))
        .catch(() => {});
    }
    return pc;
  }

  async function join(space, channel) {
    if (room) leave();
    room = { space, channel };
    status = 'connecting';
    micError = false;
    knownIds = null; // reset chime baseline for the new channel
    emit();
    try {
      localStream = await getMicStream();
      applyMic(); // honor mute / deafen / push-to-talk from the start
      setupAnalyser(myId, localStream);
    } catch {
      // No mic (permission denied, none present, or an insecure/non-HTTPS
      // origin). Join anyway in listen-only mode: presence works and you can
      // still hear everyone else.
      localStream = null;
      micError = true;
    }
    if (!speakTimer) speakTimer = setInterval(pollSpeaking, 200);
    status = 'connected';
    emit();
    send({ op: 'voice_join', space, channel });
    if (getVoiceSounds()) playSelfJoin();
  }

  function leave() {
    if (room) {
      send({ op: 'voice_leave' });
      if (getVoiceSounds()) playSelfLeave();
    }
    pcs.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    pcs.clear();
    audioEls.forEach((el) => {
      el.srcObject = null;
    });
    audioEls.clear();
    analysers.clear();
    speaking.clear();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (speakTimer) {
      clearInterval(speakTimer);
      speakTimer = null;
    }
    room = null;
    status = 'idle';
    micError = false;
    deafened = false;
    pttActive = false;
    knownIds = null;
    participants = [];
    emit();
  }

  function toggleMute() {
    muted = !muted;
    applyMic();
    if (room) send({ op: 'voice_mute', muted });
    emit();
  }

  // Deafen silences everyone else and forces your mic off; un-deafening
  // restores whatever mute state you had before (Discord's behavior).
  function toggleDeafen() {
    deafened = !deafened;
    if (deafened) {
      mutedBeforeDeafen = muted;
      muted = true;
    } else {
      muted = mutedBeforeDeafen;
    }
    applyDeafen();
    applyMic();
    if (room) send({ op: 'voice_mute', muted });
    emit();
  }

  // Push-to-talk: App calls this on key down/up for the configured key.
  function setPttActive(active) {
    if (pttActive === active) return;
    pttActive = active;
    applyMic();
    emit();
  }

  // Re-apply mic gating after the PTT setting changes while connected.
  function refreshPtt() {
    applyMic();
    emit();
  }

  // ---- Gateway frames ----
  function handlePeers(peers) {
    // We joined last, so we initiate the offer to everyone already here.
    for (const p of peers) if (!pcs.has(p.userId)) newPeer(p.userId, true);
  }
  function handlePeerJoined() {
    // A newcomer will send us their offer; the peer connection is created lazily
    // when that offer arrives (handleSignal).
  }
  async function handleSignal(from, data) {
    let pc = pcs.get(from);
    if (!pc) pc = newPeer(from, false);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ op: 'voice_signal', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch {
      /* ignore malformed signaling */
    }
  }
  function handlePeerLeft(userId) {
    const pc = pcs.get(userId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      pcs.delete(userId);
    }
    const el = audioEls.get(userId);
    if (el) {
      el.srcObject = null;
      audioEls.delete(userId);
    }
    analysers.delete(userId);
    speaking.delete(userId);
  }
  function handleState(f) {
    if (!room || f.space !== room.space || f.channel !== room.channel) return;
    participants = f.participants || [];
    const ids = new Set(participants.map((p) => p.userId));
    if (knownIds === null) {
      // First roster for this channel — establish a baseline without chiming
      // (this includes everyone already present when we joined).
      knownIds = ids;
    } else if (getVoiceSounds()) {
      for (const id of ids) if (id !== myId && !knownIds.has(id)) playPeerJoin();
      for (const id of knownIds) if (id !== myId && !ids.has(id)) playPeerLeave();
      knownIds = ids;
    } else {
      knownIds = ids;
    }
    emit();
  }

  return {
    join,
    leave,
    toggleMute,
    toggleDeafen,
    setPttActive,
    refreshPtt,
    applyOutput,
    handlePeers,
    handlePeerJoined,
    handlePeerLeft,
    handleSignal,
    handleState,
  };
}
