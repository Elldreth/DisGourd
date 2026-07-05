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
  let shareStream = null; // app/screen audio we're broadcasting (separate track)
  let shareTrack = null;
  let sharing = false;
  let shareError = ''; // last share failure message, for the UI
  let cameraStream = null; // our outgoing camera video (separate track)
  let screenStream = null; // our outgoing screen-share video (separate track)
  let videoError = ''; // last camera/screen failure message, for the UI
  const remoteVideos = new Map(); // streamId -> { userId, stream } for remote video
  let participants = []; // authoritative list from the server (voice_state)
  let knownIds = null; // Set of participant userIds, for join/leave chimes
  const pcs = new Map(); // userId -> peer state { pc, polite, makingOffer, ignoreOffer, state }
  const audioEls = new Map(); // streamId -> HTMLAudioElement (a user may send 2)
  const streamOwner = new Map(); // streamId -> userId, for cleanup
  const micStreamId = new Map(); // userId -> their first (mic) streamId
  const shareMutedUsers = new Set(); // userIds whose shared audio I've muted locally
  const shareVolume = new Map(); // userId -> local volume [0..1] for their shared audio
  const analysers = new Map(); // userId -> { analyser, data } (mic stream only)
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
      sharing,
      shareError,
      cameraOn: !!cameraStream,
      screenOn: !!screenStream,
      videoError,
      videos: buildVideoTiles(),
      participants: participants.map((p) => ({
        ...p,
        speaking: speaking.has(p.userId),
        shareMutedLocally: shareMutedUsers.has(p.userId),
        shareVolume: shareVolume.has(p.userId) ? shareVolume.get(p.userId) : 1,
      })),
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

  // A stream is "shared audio" (not a mic) if its owner has an earlier stream.
  function isShareStream(sid) {
    const owner = streamOwner.get(sid);
    return owner != null && micStreamId.get(owner) !== sid;
  }

  // Apply the effective mute/volume for one remote element: deafen silences
  // everything; otherwise a shared-audio stream honors this listener's local
  // mute and volume for that user.
  function applyElState(sid, el) {
    const owner = streamOwner.get(sid);
    if (isShareStream(sid)) {
      el.muted = deafened || shareMutedUsers.has(owner);
      el.volume = shareVolume.has(owner) ? shareVolume.get(owner) : 1;
    } else {
      el.muted = deafened;
    }
  }

  function applyDeafen() {
    audioEls.forEach((el, sid) => applyElState(sid, el));
  }

  // Locally mute/unmute another user's shared audio (does not affect their
  // voice, and is this listener's choice only).
  function toggleShareMute(userId) {
    if (shareMutedUsers.has(userId)) shareMutedUsers.delete(userId);
    else shareMutedUsers.add(userId);
    audioEls.forEach((el, sid) => {
      if (streamOwner.get(sid) === userId && isShareStream(sid)) applyElState(sid, el);
    });
    emit();
  }

  // Set the local playback volume of another user's shared audio.
  function setShareVolume(userId, vol) {
    shareVolume.set(userId, vol);
    audioEls.forEach((el, sid) => {
      if (streamOwner.get(sid) === userId && isShareStream(sid)) applyElState(sid, el);
    });
    emit();
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
    const sid = stream.id;
    let el = audioEls.get(sid);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      audioEls.set(sid, el);
      streamOwner.set(sid, userId);
    }
    el.srcObject = stream;
    // Only a user's first stream (their mic) drives the speaking indicator; a
    // shared-audio stream must not light up their avatar.
    if (!micStreamId.has(userId)) {
      micStreamId.set(userId, sid);
      setupAnalyser(userId, stream);
    }
    applyElState(sid, el); // honor deafen + any local share mute/volume
    applySink(el);
    playEl(el);
    // Drop the element when a shared stream stops (sharer ended it).
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => removeStream(sid);
    });
  }

  function removeStream(sid) {
    const el = audioEls.get(sid);
    if (el) {
      el.srcObject = null;
      audioEls.delete(sid);
    }
    const owner = streamOwner.get(sid);
    streamOwner.delete(sid);
    if (owner != null && micStreamId.get(owner) === sid) {
      micStreamId.delete(owner);
      analysers.delete(owner);
      speaking.delete(owner);
    }
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
    // If we're already broadcasting app audio, send that too (as its own track)
    // so peers joining mid-share hear it.
    if (shareStream) shareStream.getTracks().forEach((t) => pc.addTrack(t, shareStream));
    // Likewise any camera / screen video already running.
    if (cameraStream) cameraStream.getTracks().forEach((t) => pc.addTrack(t, cameraStream));
    if (screenStream) screenStream.getTracks().forEach((t) => pc.addTrack(t, screenStream));

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

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (e.track.kind === 'video') addRemoteVideo(userId, stream, e.track);
      else attachRemote(userId, stream);
    };

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
    if (sharing || shareTrack) stopShare();
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    remoteVideos.clear();
    if (room) {
      send({ op: 'voice_leave' });
      if (getVoiceSounds()) playSelfLeave();
    }
    pcs.forEach((st) => {
      try {
        st.pc.close();
      } catch {
        /* ignore */
      }
    });
    pcs.clear();
    audioEls.forEach((el) => {
      el.srcObject = null;
    });
    audioEls.clear();
    streamOwner.clear();
    micStreamId.clear();
    shareMutedUsers.clear();
    shareVolume.clear();
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
    sharing = false;
    shareError = '';
    videoError = '';
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

  // Start broadcasting app/screen audio as a SEPARATE track alongside the mic,
  // so you can keep talking while others hear (e.g.) music. The audio is
  // captured via getDisplayMedia; only Chromium actually provides it.
  async function startShare() {
    if (!room || sharing) return;
    shareError = '';
    emit();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      return; // user dismissed the picker — nothing to report
    }
    // We only want the audio; discard any video (Phase C handles video).
    stream.getVideoTracks().forEach((t) => t.stop());
    const audio = stream.getAudioTracks()[0];
    if (!audio) {
      stream.getTracks().forEach((t) => t.stop());
      shareError =
        'No audio was captured. Use Chrome/Edge and share a Tab with “Share tab audio”, or your whole Screen with “Share system audio”.';
      emit();
      return;
    }
    shareStream = new MediaStream([audio]);
    shareTrack = audio;
    sharing = true;
    audio.onended = () => stopShare(); // browser's native "Stop sharing"
    pcs.forEach(({ pc }) => pc.addTrack(audio, shareStream)); // triggers renegotiation
    send({ op: 'voice_share', sharing: true });
    emit();
  }

  function stopShare() {
    if (!sharing && !shareTrack) return;
    sharing = false;
    if (shareTrack) {
      pcs.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === shareTrack);
        if (sender) {
          try {
            pc.removeTrack(sender); // triggers renegotiation
          } catch {
            /* ignore */
          }
        }
      });
      shareTrack.onended = null;
      try {
        shareTrack.stop();
      } catch {
        /* ignore */
      }
    }
    shareStream = null;
    shareTrack = null;
    if (room) send({ op: 'voice_share', sharing: false });
    emit();
  }

  function toggleShare() {
    if (sharing) stopShare();
    else startShare();
  }

  // ---- Video: camera & screen share ----
  function nameFor(userId) {
    const p = participants.find((x) => x.userId === userId);
    return p ? p.username : '';
  }

  // The tiles the video grid should render: our own camera/screen previews plus
  // every remote video stream.
  function buildVideoTiles() {
    const tiles = [];
    if (cameraStream) {
      tiles.push({ key: 'self-camera', userId: myId, label: 'You', stream: cameraStream, self: true, mirror: true });
    }
    if (screenStream) {
      tiles.push({ key: 'self-screen', userId: myId, label: 'You — screen', stream: screenStream, self: true, mirror: false });
    }
    for (const [sid, v] of remoteVideos) {
      tiles.push({ key: sid, userId: v.userId, label: nameFor(v.userId), stream: v.stream, self: false, mirror: false });
    }
    return tiles;
  }

  function addRemoteVideo(userId, stream, track) {
    remoteVideos.set(stream.id, { userId, stream });
    track.onended = () => {
      if (remoteVideos.delete(stream.id)) emit();
    };
    emit();
  }

  function addTrackToPeers(track, stream) {
    pcs.forEach(({ pc }) => pc.addTrack(track, stream)); // triggers renegotiation
  }
  function removeTrackFromPeers(track) {
    pcs.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) {
        try {
          pc.removeTrack(sender);
        } catch {
          /* ignore */
        }
      }
    });
  }

  async function startCamera() {
    if (!room || cameraStream) return;
    videoError = '';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      videoError = 'Could not access the camera. Check the browser and OS camera permissions.';
      emit();
      return;
    }
    cameraStream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) track.onended = () => stopCamera();
    addTrackToPeers(track, stream);
    emit();
  }
  function stopCamera() {
    if (!cameraStream) return;
    cameraStream.getTracks().forEach((t) => {
      removeTrackFromPeers(t);
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    cameraStream = null;
    emit();
  }

  async function startScreen() {
    if (!room || screenStream) return;
    videoError = '';
    let stream;
    try {
      // Video only; screen *audio* is handled by the separate "share app audio".
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // user dismissed the picker
    }
    screenStream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) track.onended = () => stopScreen(); // browser's native "Stop sharing"
    addTrackToPeers(track, stream);
    emit();
  }
  function stopScreen() {
    if (!screenStream) return;
    screenStream.getTracks().forEach((t) => {
      removeTrackFromPeers(t);
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    screenStream = null;
    emit();
  }

  function toggleCamera() {
    if (cameraStream) stopCamera();
    else startCamera();
  }
  function toggleScreen() {
    if (screenStream) stopScreen();
    else startScreen();
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
    // Tear down every stream this user was sending (mic and any shared audio).
    for (const [sid, owner] of streamOwner) {
      if (owner === userId) {
        const el = audioEls.get(sid);
        if (el) el.srcObject = null;
        audioEls.delete(sid);
        streamOwner.delete(sid);
      }
    }
    for (const [sid, v] of remoteVideos) {
      if (v.userId === userId) remoteVideos.delete(sid);
    }
    micStreamId.delete(userId);
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
    startShare,
    stopShare,
    toggleShare,
    toggleShareMute,
    setShareVolume,
    toggleCamera,
    toggleScreen,
    stopCamera,
    stopScreen,
    applyOutput,
    handlePeers,
    handlePeerJoined,
    handlePeerLeft,
    handleSignal,
    handleState,
  };
}
