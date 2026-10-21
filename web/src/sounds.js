// Short UI sounds for voice events, messages and the speaker test (P5-06):
// small designed sound files in /sounds (made with kie.ai, see
// design/sounds/PROMPTS.md), played with WebAudio and routed to the user's
// preferred output device, so the speaker test exercises the chosen speaker.
// If a file can't be fetched or decoded, the older synthesized tones play
// instead, so a sound is never silently lost.
import { getPreferredOutput } from './audio.js';

let ctx = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// Play whatever `build(context, input)` connects to `input`, through the
// preferred output device; `build` returns how long it lasts, in seconds.
async function route(build, volume) {
  const c = audioCtx();
  if (c.state === 'suspended') await c.resume();
  const dest = c.createMediaStreamDestination();
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(dest);
  const seconds = build(c, master);

  const el = new Audio();
  el.srcObject = dest.stream;
  el.autoplay = true;
  const out = getPreferredOutput();
  if (out && typeof el.setSinkId === 'function') {
    await el.setSinkId(out).catch(() => {});
  }
  await el.play().catch(() => {});
  // Release the element once the sound has finished.
  setTimeout(() => {
    el.srcObject = null;
  }, seconds * 1000 + 300);
}

// The fallback: a sequence of [frequency, durationSeconds] sine tones.
async function playTones(tones, { volume = 0.14 } = {}) {
  try {
    await route((c, master) => {
      let t = c.currentTime + 0.02;
      for (const [freq, dur] of tones) {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // Tiny attack/release envelope so tones don't click.
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur;
      }
      return t - c.currentTime;
    }, volume);
  } catch {
    /* sounds are best-effort */
  }
}

// Each file is fetched and decoded once, on first use; null when it can't be.
const buffers = new Map();
function loadSound(name) {
  if (!buffers.has(name)) {
    buffers.set(
      name,
      fetch(`/sounds/${name}.ogg`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((bytes) => audioCtx().decodeAudioData(bytes))
        .catch(() => null)
    );
  }
  return buffers.get(name);
}

// Play a sound file, or its fallback tones.
async function playSound(name, fallback, { volume = 0.5, fallbackVolume } = {}) {
  try {
    const buffer = await loadSound(name);
    if (!buffer) return playTones(fallback, { volume: fallbackVolume });
    await route((c, master) => {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(master);
      src.start();
      return buffer.duration;
    }, volume);
  } catch {
    return playTones(fallback, { volume: fallbackVolume });
  }
  return undefined;
}

// You connected / disconnected.
export const playSelfJoin = () => playSound('join', [[523.25, 0.09], [783.99, 0.13]]); // fallback C5 → G5
export const playSelfLeave = () => playSound('leave', [[783.99, 0.09], [523.25, 0.13]]); // G5 → C5
// Someone else joined / left your channel (softer).
export const playPeerJoin = () => playSound('peer-join', [[587.33, 0.07], [739.99, 0.1]], { volume: 0.4, fallbackVolume: 0.1 }); // D5 → F#5
export const playPeerLeave = () => playSound('peer-leave', [[587.33, 0.07], [440.0, 0.1]], { volume: 0.4, fallbackVolume: 0.1 }); // D5 → A4
// Speaker test: the join sound, a touch louder.
export const playTestTone = () => playSound('join', [[440, 0.16], [660, 0.18]], { volume: 0.7, fallbackVolume: 0.2 });
// New message elsewhere (only at the "all messages" level): one soft pop.
export const playMessage = () => playSound('message', [[880, 0.06]], { volume: 0.35, fallbackVolume: 0.08 }); // A5
// P10-08, both at the message-sounds setting:
// a new report for a moderator: a soft two-knock heads-up;
export const playReport = () => playSound('report', [[392.0, 0.07], [329.63, 0.1]], { volume: 0.45, fallbackVolume: 0.1 }); // G4 → E4
// someone added you to a group: a light rising pluck.
export const playGroup = () => playSound('group', [[523.25, 0.06], [659.25, 0.06], [783.99, 0.1]], { volume: 0.45, fallbackVolume: 0.1 }); // C5 E5 G5
// A mention or DM: a brighter two-note chime.
export const playMention = () => playSound('mention', [[659.25, 0.07], [987.77, 0.12]], { volume: 0.5, fallbackVolume: 0.12 }); // E5 → B5
