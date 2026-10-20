// P5-06: UI sounds play designed sound files, and fall back to the old
// synthesized tones when a file can't be fetched or decoded.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let ctx;
function fakeAudioContext() {
  const made = { oscillators: 0, sources: [], decoded: [] };
  class FakeCtx {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      ctx = this;
      this.made = made;
    }
    resume() {
      return Promise.resolve();
    }
    createMediaStreamDestination() {
      return { stream: {} };
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n };
    }
    createOscillator() {
      made.oscillators += 1;
      return { type: '', frequency: { value: 0 }, connect: (n) => n, start() {}, stop() {} };
    }
    createBufferSource() {
      const src = { buffer: null, started: false, connect: (n) => n, start() { src.started = true; } };
      made.sources.push(src);
      return src;
    }
    decodeAudioData(bytes) {
      if (bytes.byteLength === 0) return Promise.reject(new Error('bad audio'));
      const buf = { duration: 0.5, bytes };
      made.decoded.push(buf);
      return Promise.resolve(buf);
    }
  }
  return FakeCtx;
}

beforeEach(() => {
  vi.resetModules();
  window.AudioContext = fakeAudioContext();
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

test('a sound plays its file (fetched once, then reused)', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetchMock);
  const sounds = await import('./sounds.js');
  await sounds.playMention();
  await sounds.playMention();
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/sounds/mention.ogg');
  expect(ctx.made.sources).toHaveLength(2);
  expect(ctx.made.sources.every((s) => s.started)).toBe(true);
  expect(ctx.made.oscillators).toBe(0);
});

test('each UI event has its own file; the speaker test reuses "join"', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetchMock);
  const s = await import('./sounds.js');
  for (const play of [s.playSelfJoin, s.playSelfLeave, s.playPeerJoin, s.playPeerLeave, s.playMessage, s.playMention, s.playTestTone]) await play();
  expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(
    ['/sounds/join.ogg', '/sounds/leave.ogg', '/sounds/mention.ogg', '/sounds/message.ogg', '/sounds/peer-join.ogg', '/sounds/peer-leave.ogg'].sort()
  );
});

test('a missing file falls back to the synthesized tones, without throwing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
  const sounds = await import('./sounds.js');
  await expect(sounds.playSelfJoin()).resolves.toBeUndefined();
  expect(ctx.made.oscillators).toBe(2); // the old two-note tone
  expect(ctx.made.sources).toHaveLength(0);
});

test('a network error or an undecodable file also falls back', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  let sounds = await import('./sounds.js');
  await sounds.playMessage();
  expect(ctx.made.oscillators).toBe(1);
  vi.resetModules();
  window.AudioContext = fakeAudioContext();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  sounds = await import('./sounds.js');
  await sounds.playMessage();
  expect(ctx.made.oscillators).toBe(1);
});
