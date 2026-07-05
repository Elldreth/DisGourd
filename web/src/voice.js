// Mesh WebRTC voice controller. There is NO media server — peers connect
// directly to each other and the gateway only relays signaling (SDP + ICE).
// onChange(state) pushes updates to React. Great for small friend-group calls.
//
// STUN handles most NATs; for tricky networks add a TURN server by setting
// window.__DISGOURD_ICE__ (an array of RTCIceServer objects) before load.
const ICE_SERVERS =
  (typeof window !== 'undefined' && window.__DISGOURD_ICE__) || [
    { urls: 'stun:stun.l.google.com:19302' },
  ];

export function createVoiceController({ send, myId, onChange }) {
  let room = null; // { space, channel }
  let status = 'idle'; // idle | connecting | connected | error
  let muted = false;
  let localStream = null;
  let participants = []; // authoritative list from the server (voice_state)
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
      participants: participants.map((p) => ({ ...p, speaking: speaking.has(p.userId) })),
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
      const active = level > 12 && !(userId === myId && muted);
      if (active !== speaking.has(userId)) {
        if (active) speaking.add(userId);
        else speaking.delete(userId);
        changed = true;
      }
    }
    if (changed) emit();
  }

  function newPeer(userId, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
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
    emit();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status = 'error';
      room = null;
      emit();
      return;
    }
    if (muted) localStream.getAudioTracks().forEach((t) => (t.enabled = false));
    setupAnalyser(myId, localStream);
    if (!speakTimer) speakTimer = setInterval(pollSpeaking, 200);
    status = 'connected';
    emit();
    send({ op: 'voice_join', space, channel });
  }

  function leave() {
    if (room) send({ op: 'voice_leave' });
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
    participants = [];
    emit();
  }

  function toggleMute() {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (room) send({ op: 'voice_mute', muted });
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
    emit();
  }

  return {
    join,
    leave,
    toggleMute,
    handlePeers,
    handlePeerJoined,
    handlePeerLeft,
    handleSignal,
    handleState,
  };
}
