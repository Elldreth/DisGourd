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
  const pcs = new Map(); // userId -> peer state { pc, polite, makingOffer, ignoreOffer, state }
  const audioEls = new Map(); // userId -> HTMLAudioElement
  const analysers = new Map(); // userId -> { analyser, data }
  const speaking = new Set(); // userIds currently speaking
  let audioCtx = null;
  let speakTimer = null;
  const pendingPlay = new Set(); // audio elements blocked by autoplay policy
  let autoplayArmed = false;

  // A peer link is "unstable" once it has dropped and is trying to recover.
  function unstable() {
    for (const st of pcs.values()) {
      if (st.state === 'disconnected' || st.state === 'failed') return true;
    }
    return false;
  }

  function emit() {
    onChange({
      room,
      status,
      muted,
      deafened,
      pttEnabled: getPttEnabled(),
      micError,
      unstable: unstable(),
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

  // Try to play an element; if the browser blocks autoplay, queue it and retry
  // on the next user gesture so remote audio always eventually starts.
  function playEl(el) {
    const p = el.play?.();
    if (p && p.catch) {
      p.catch(() => {
        pendingPlay.add(el);
        armAutoplayResume();
      });
    }
  }

  function armAutoplayResume() {
    if (autoplayArmed) return;
    autoplayArmed = true;
    const resume = () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      pendingPlay.forEach((el) => {
        const p = el.play?.();
        if (p && p.catch) p.catch(() => {});
      });
      pendingPlay.clear();
      autoplayArmed = false;
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  function attachRemote(userId, stream) {
    if (!stream) return;
    let el = audioEls.get(userId);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      audioEls.set(userId, el);
    }
    el.srcObject = stream;
    el.muted = deafened;
    applySink(el);
    playEl(el);
    setupAnalyser(userId, stream);
  }

  // Create (or reuse) a peer connection using the "perfect negotiation" pattern
  // so either side can (re)negotiate — needed for reconnects and, later, for
  // adding screen/app-audio tracks mid-call without glare.
  function newPeer(userId) {
    const existing = pcs.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Deterministic, opposite roles per pair so simultaneous offers resolve.
    const polite = Number(myId) < Number(userId);
    const st = { pc, polite, makingOffer: false, ignoreOffer: false, state: 'new' };
    pcs.set(userId, st);

    // Our outgoing media. With a mic we send it; without one we still add a
    // receive-only line so we can hear everyone (listen-only mode).
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    } else {
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        /* ignore */
      }
    }

    pc.onnegotiationneeded = async () => {
      try {
        st.makingOffer = true;
        await pc.setLocalDescription();
        send({ op: 'voice_signal', to: userId, data: { sdp: pc.localDescription } });
      } catch {
        /* ignore */
      } finally {
        st.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ op: 'voice_signal', to: userId, data: { candidate } });
    };

    pc.oniceconnectionstatechange = () => {
      // A dropped link (network blip, roaming) recovers via an ICE restart
      // instead of going silent forever.
      if (pc.iceConnectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {
          /* older browsers: renegotiation below will still retry */
        }
      }
    };

    pc.onconnectionstatechange = () => {
      st.state = pc.connectionState;
      emit();
    };

    pc.ontrack = ({ streams }) => attachRemote(userId, streams[0]);

    return st;
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
    pendingPlay.clear();
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

  // Swap the outgoing microphone live (used when the preferred input device
  // changes mid-call) without dropping the connection.
  async function switchMic() {
    if (!room) return;
    let stream;
    try {
      stream = await getMicStream();
    } catch {
      return; // keep the current mic if the new one can't be opened
    }
    const track = stream.getAudioTracks()[0];
    const oldTrack = localStream && localStream.getAudioTracks()[0];
    pcs.forEach(({ pc }) => {
      const sender = oldTrack && pc.getSenders().find((s) => s.track === oldTrack);
      if (sender) sender.replaceTrack(track).catch(() => {});
      else pc.addTrack(track, stream); // upgrading from listen-only → renegotiates
    });
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = stream;
    micError = false;
    applyMic(); // preserve mute / push-to-talk state on the new track
    setupAnalyser(myId, localStream);
    emit();
  }

  // ---- Gateway frames ----
  // Both sides proactively create the peer connection (the joiner from the peer
  // list, existing members from peer-joined); perfect negotiation resolves the
  // resulting simultaneous offers.
  function handlePeers(peers) {
    for (const p of peers) newPeer(p.userId);
  }
  function handlePeerJoined(peer) {
    if (peer && peer.userId != null) newPeer(peer.userId);
  }
  async function handleSignal(from, data) {
    const st = pcs.get(from) || newPeer(from);
    const { pc } = st;
    try {
      if (data.sdp) {
        const desc = data.sdp;
        const collision = desc.type === 'offer' && (st.makingOffer || pc.signalingState !== 'stable');
        st.ignoreOffer = !st.polite && collision;
        if (st.ignoreOffer) return; // impolite peer keeps its own offer
        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          send({ op: 'voice_signal', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!st.ignoreOffer) throw err; // ignore candidates for a rejected offer
        }
      }
    } catch {
      /* ignore malformed or out-of-order signaling */
    }
  }
  function handlePeerLeft(userId) {
    const st = pcs.get(userId);
    if (st) {
      try {
        st.pc.close();
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
    switchMic,
    applyOutput,
    handlePeers,
    handlePeerJoined,
    handlePeerLeft,
    handleSignal,
    handleState,
  };
}
