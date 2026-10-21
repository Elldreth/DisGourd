import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createVoiceController } from './voice.js';

// Just enough WebRTC and media for the controller: a fake microphone and peer
// connections that record what happens to them.
let pcs;
class FakePC {
  constructor(config) {
    this.config = config; // P11-11: ICE servers and transport policy
    this.closed = false;
    this.connectionState = 'new';
    pcs.push(this);
  }
  addTrack() {}
  addTransceiver() {}
  // Signalling, enough for the negotiation test: each call is recorded, and a
  // test can hold one open via `hold`.
  async setRemoteDescription(desc) {
    (this.remote ||= []).push(desc.type);
    if (this.hold) await this.hold;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.hasRemote = true;
  }
  async setLocalDescription() {
    this.localDescription = { type: this.signalingState === 'have-remote-offer' ? 'answer' : 'offer' };
    this.signalingState = this.localDescription.type === 'answer' ? 'stable' : 'have-local-offer';
  }
  // Like a real browser: a candidate before any remote description is an error.
  async addIceCandidate(c) {
    if (!this.hasRemote) throw new Error('InvalidStateError');
    (this.candidates ||= []).push(c);
  }
  close() {
    this.closed = true;
  }
}
const micTrack = () => ({ kind: 'audio', enabled: true, stop: vi.fn() });

let getUserMedia;
let sent;
let state;
let voice;

beforeEach(() => {
  vi.useFakeTimers();
  pcs = [];
  sent = [];
  localStorage.clear();
  vi.stubGlobal('RTCPeerConnection', FakePC);
  getUserMedia = vi.fn(async () => {
    const tracks = [micTrack()];
    return { id: 'mic', getTracks: () => tracks, getAudioTracks: () => tracks };
  });
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  voice = createVoiceController({ send: (f) => sent.push(f), myId: 1, onChange: (s) => (state = s) });
});
afterEach(() => {
  voice.leave();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ops = () => sent.map((f) => f.op);

async function inCallWithBob() {
  await voice.join('S', 'lounge');
  voice.handlePeers([{ userId: 2, username: 'bob' }]);
  voice.handleState({ space: 'S', channel: 'lounge', participants: [{ userId: 1 }, { userId: 2 }] });
  sent.length = 0;
}

test('rejoin closes the old links, keeps your mic, and joins again', async () => {
  await inCallWithBob();
  const oldLink = pcs[0];

  voice.rejoin();
  expect(oldLink.closed).toBe(true);
  expect(ops()).toEqual(['voice_join']);
  expect(sent[0]).toMatchObject({ space: 'S', channel: 'lounge' });
  expect(state.unstable).toBe(true); // shows "Reconnecting…" until the server answers

  voice.handlePeers([{ userId: 2, username: 'bob' }]);
  expect(pcs).toHaveLength(2); // a fresh link to bob
  expect(pcs[1].closed).toBe(false);
  expect(state.unstable).toBe(false);
  expect(getUserMedia).toHaveBeenCalledTimes(1); // no second mic prompt
  expect(state.status).toBe('connected');
});

test('rejoin re-sends your mute state, which the server forgets', async () => {
  await inCallWithBob();
  voice.toggleMute();
  sent.length = 0;
  voice.rejoin();
  expect(sent).toEqual([{ op: 'voice_join', space: 'S', channel: 'lounge' }, { op: 'voice_mute', muted: true }]);
});

test('rejoin does nothing when you are not in a call', () => {
  voice.rejoin();
  expect(sent).toEqual([]);
});

test('if the server never takes you back, the call ends with a note saying why', async () => {
  await inCallWithBob();
  voice.rejoin();
  vi.advanceTimersByTime(5000);
  expect(state.room).toBeNull();
  expect(state.status).toBe('idle');
  expect(state.notice).toMatch(/couldn.t rejoin #lounge/i);
  expect(pcs.every((pc) => pc.closed)).toBe(true);

  voice.clearNotice();
  expect(state.notice).toBe('');
});

test('a successful rejoin cancels that timeout', async () => {
  await inCallWithBob();
  voice.rejoin();
  voice.handlePeers([]); // alone in the room now, but back in it
  vi.advanceTimersByTime(10000);
  expect(state.room).toEqual({ space: 'S', channel: 'lounge' });
  expect(state.notice).toBe('');
});

test('joining another call clears an old notice', async () => {
  await inCallWithBob();
  voice.rejoin();
  vi.advanceTimersByTime(5000);
  await voice.join('S', 'lounge');
  expect(state.notice).toBe('');
});

test('an offer arriving while the previous answer is still being applied is not dropped', async () => {
  // The impolite side (higher id) has an offer out. The other side answers it
  // and then sends a fresh offer straight after; both arrive back to back.
  const v = createVoiceController({ send: (f) => sent.push(f), myId: 3, onChange: () => {} });
  v.handlePeers([{ userId: 2 }]);
  const pc = pcs.at(-1);
  pc.signalingState = 'have-local-offer';
  let release;
  pc.hold = new Promise((r) => (release = r));

  const answering = v.handleSignal(2, { sdp: { type: 'answer' } });
  const offering = v.handleSignal(2, { sdp: { type: 'offer' } });
  pc.hold = null;
  release();
  await Promise.all([answering, offering]);

  expect(pc.remote).toEqual(['answer', 'offer']);
  expect(sent.at(-1)).toMatchObject({ op: 'voice_signal', to: 2, data: { sdp: { type: 'answer' } } });
  v.leave();
});

test('a candidate that arrives while the offer is still being applied is not lost', async () => {
  const v = createVoiceController({ send: (f) => sent.push(f), myId: 1, onChange: () => {} });
  v.handlePeers([{ userId: 2 }]);
  const pc = pcs.at(-1);
  pc.signalingState = 'stable';
  let release;
  pc.hold = new Promise((r) => (release = r));

  const offer = v.handleSignal(2, { sdp: { type: 'offer' } });
  const candidate = v.handleSignal(2, { candidate: { candidate: 'host-1' } });
  pc.hold = null;
  release();
  await Promise.all([offer, candidate]);

  expect(pc.candidates).toEqual([{ candidate: 'host-1' }]);
  v.leave();
});

test('only the joiner starts the connection; people already in the call wait for its offer', async () => {
  await voice.join('S', 'lounge');
  voice.handlePeerJoined({ userId: 2, username: 'bob' });
  expect(pcs).toHaveLength(0); // no competing offer from our side
  await voice.handleSignal(2, { sdp: { type: 'offer' } });
  expect(pcs).toHaveLength(1); // the link is made when bob's offer arrives
  expect(sent.at(-1)).toMatchObject({ op: 'voice_signal', to: 2, data: { sdp: { type: 'answer' } } });
});

// ---- Video tiles (the voice stage) ----
// A fake analyser whose loudness each test can set per stream.
let loudness;
class FakeAudioContext {
  createAnalyser() {
    const a = { fftSize: 0, frequencyBinCount: 4, getByteFrequencyData: (d) => d.fill(loudness[a.streamId] || 0) };
    this.last = a;
    return a;
  }
  createMediaStreamSource(stream) {
    const ctx = this;
    return { connect: (a) => (a.streamId = stream.id ?? ctx.last.streamId) };
  }
}
const videoStream = (id, settings = {}) => {
  const track = { kind: 'video', getSettings: () => settings, stop: vi.fn() };
  return { stream: { id, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] }, track };
};
const audioStream = (id) => {
  const track = { kind: 'audio', enabled: true, stop: vi.fn() };
  return { id, getTracks: () => [track], getAudioTracks: () => [track] };
};

test('remote video tiles say whose they are, whether it is a screen, and if that person is speaking', async () => {
  loudness = {};
  vi.stubGlobal('AudioContext', FakeAudioContext);
  await inCallWithBob();
  voice.handleState({ space: 'S', channel: 'lounge', participants: [{ userId: 1, username: 'sandy' }, { userId: 2, username: 'bob' }] });
  const link = pcs[0];
  const cam = videoStream('bob-cam');
  link.ontrack({ track: cam.track, streams: [cam.stream] });
  const scr = videoStream('bob-screen', { displaySurface: 'monitor' });
  link.ontrack({ track: scr.track, streams: [scr.stream] });
  const mic = audioStream('bob-mic');
  link.ontrack({ track: mic.getAudioTracks()[0], streams: [mic] });

  expect(state.videos.map((t) => [t.key, t.userId, t.kind, t.speaking])).toEqual([
    ['bob-cam', 2, 'camera', false],
    ['bob-screen', 2, 'screen', false],
  ]);
  // Two videos from one person get told apart (a received screen share often
  // can't be recognised as one).
  expect(state.videos.map((t) => t.label)).toEqual(['bob', 'bob (2)']);

  loudness['bob-mic'] = 80; // bob starts talking
  vi.advanceTimersByTime(250);
  expect(state.videos.every((t) => t.speaking)).toBe(true);

  loudness['bob-mic'] = 0;
  vi.advanceTimersByTime(250);
  expect(state.videos.some((t) => t.speaking)).toBe(false);
});

test('your own camera and screen tiles know their kind', async () => {
  await inCallWithBob();
  const cam = videoStream('my-cam');
  getUserMedia.mockResolvedValueOnce(cam.stream);
  await voice.toggleCamera();
  const scr = videoStream('my-screen');
  navigator.mediaDevices.getDisplayMedia = vi.fn(async () => scr.stream);
  await voice.toggleScreen();
  expect(state.videos.map((t) => [t.key, t.kind, t.self])).toEqual([
    ['self-camera', 'camera', true],
    ['self-screen', 'screen', true],
  ]);
});

test('a remote video tile goes away when the sender stops it (the track is removed, not ended)', async () => {
  await inCallWithBob();
  const scr = videoStream('bob-screen');
  let tracks = [scr.track];
  scr.stream.getVideoTracks = () => tracks;
  pcs[0].ontrack({ track: scr.track, streams: [scr.stream] });
  expect(state.videos.map((t) => t.key)).toEqual(['bob-screen']);
  tracks = []; // what a browser does when bob's renegotiation drops the track
  scr.stream.onremovetrack?.({ track: scr.track });
  expect(state.videos).toEqual([]);
});

// P3-26c: timed out in the call's server, and calls ended by the server.
test('a forced mute turns the mic off, and unmuting does nothing until it lifts', async () => {
  await inCallWithBob();
  voice.setForcedMute(true);
  expect(state).toMatchObject({ muted: true, forcedMute: true });
  expect(sent).toContainEqual({ op: 'voice_mute', muted: true });
  sent.length = 0;
  voice.toggleMute();
  expect(state.muted).toBe(true);
  expect(sent).toEqual([]);
  // Deafen and undeafen keeps you muted while it lasts.
  voice.toggleDeafen();
  voice.toggleDeafen();
  expect(state.muted).toBe(true);
  // Lifted: still muted, but you can unmute now.
  voice.setForcedMute(false);
  expect(state).toMatchObject({ muted: true, forcedMute: false });
  voice.toggleMute();
  expect(state.muted).toBe(false);
});

test('the server ending the call leaves it and says why; a new call starts unforced', async () => {
  await inCallWithBob();
  voice.setForcedMute(true);
  voice.endCall('Your call in #lounge ended: you were banned from S.');
  expect(state).toMatchObject({ room: null, status: 'idle', forcedMute: false, notice: 'Your call in #lounge ended: you were banned from S.' });
  expect(pcs[0].closed).toBe(true);
  // Not in a call: nothing to end, nothing to force.
  voice.endCall('again');
  expect(state.notice).toBe('Your call in #lounge ended: you were banned from S.');
  voice.setForcedMute(true);
  expect(state.forcedMute).toBe(false);
});

// P6-03 / P6-04: a rename of the call's channel or server moves the call; a
// rejoin after it uses the new names, and the new name's roster is accepted.
test('renaming the channel or the server moves the call along', async () => {
  await inCallWithBob();
  voice.renameRoom('S', 'other', 'x'); // not our channel: nothing changes
  expect(state.room).toEqual({ space: 'S', channel: 'lounge' });
  voice.renameRoom('S', 'lounge', 'hangout');
  expect(state.room).toEqual({ space: 'S', channel: 'hangout' });
  voice.renameSpace('T', 'U'); // not our server
  expect(state.room).toEqual({ space: 'S', channel: 'hangout' });
  voice.renameSpace('S', 'Studio');
  expect(state.room).toEqual({ space: 'Studio', channel: 'hangout' });
  voice.handleState({ space: 'Studio', channel: 'hangout', participants: [{ userId: 1 }, { userId: 2 }, { userId: 3 }] });
  expect(state.participants).toHaveLength(3);
  voice.rejoin();
  expect(sent.find((f) => f.op === 'voice_join')).toMatchObject({ space: 'Studio', channel: 'hangout' });
});

// ---- P11-11: ICE servers from the server, relay-only, forced mute ----
const STUN_DEFAULT = [{ urls: 'stun:stun.l.google.com:19302' }];
const TURN = { urls: ['turn:turn.example.org:3478'], username: 'u', credential: 'c' };

function withIce(loadIce) {
  voice.leave();
  voice = createVoiceController({ send: (f) => sent.push(f), myId: 1, onChange: (s) => (state = s), loadIce });
}

test('with no ICE loader, links use plain STUN and no transport policy (as before)', async () => {
  await inCallWithBob();
  expect(pcs[0].config).toEqual({ iceServers: STUN_DEFAULT });
});

test('the server’s ICE servers are used; relay-only becomes iceTransportPolicy "relay"', async () => {
  const loadIce = vi.fn(async () => ({ iceServers: [TURN], relayOnly: true, expiresAt: Date.now() + 3600e3 }));
  withIce(loadIce);
  await inCallWithBob();
  expect(loadIce).toHaveBeenCalledTimes(1);
  expect(pcs[0].config).toEqual({ iceServers: [TURN], iceTransportPolicy: 'relay' });
});

test('without relay-only, the relay is a fallback (no policy set)', async () => {
  withIce(async () => ({ iceServers: [TURN], relayOnly: false, expiresAt: Date.now() + 3600e3 }));
  await inCallWithBob();
  expect(pcs[0].config).toEqual({ iceServers: [TURN] });
});

test('the answer is reused until it nearly expires, then fetched again', async () => {
  const loadIce = vi.fn(async () => ({ iceServers: [TURN], relayOnly: false, expiresAt: Date.now() + 3600e3 }));
  withIce(loadIce);
  await voice.join('S', 'lounge');
  voice.leave();
  await voice.join('S', 'lounge');
  expect(loadIce).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3600e3);
  voice.leave();
  await voice.join('S', 'lounge');
  expect(loadIce).toHaveBeenCalledTimes(2);
});

test('if the server can’t be asked, calls still work over STUN', async () => {
  withIce(async () => {
    throw new Error('offline');
  });
  await inCallWithBob();
  expect(state.status).toBe('connected');
  expect(pcs[0].config).toEqual({ iceServers: STUN_DEFAULT });
});

test('a peer the server marks as forced-muted is not played, until the mark clears', async () => {
  const els = [];
  vi.stubGlobal('Audio', class {
    constructor() {
      this.muted = false;
      els.push(this);
    }
    play() {
      return Promise.resolve();
    }
  });
  await inCallWithBob();
  const bobMic = { id: 'bob-mic', getAudioTracks: () => [{}] };
  pcs[0].ontrack({ streams: [bobMic], track: { kind: 'audio' } });
  expect(els[0].muted).toBe(false);
  voice.handleState({ space: 'S', channel: 'lounge', participants: [{ userId: 1 }, { userId: 2, muted: true, forced: true }] });
  expect(els[0].muted).toBe(true);
  voice.handleState({ space: 'S', channel: 'lounge', participants: [{ userId: 1 }, { userId: 2, muted: true, forced: false }] });
  expect(els[0].muted).toBe(false); // an ordinary mute is theirs to keep: nothing to hide
});
