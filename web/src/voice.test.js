import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createVoiceController } from './voice.js';

// Just enough WebRTC and media for the controller: a fake microphone and peer
// connections that record what happens to them.
let pcs;
class FakePC {
  constructor() {
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
