// Short UI chimes for voice events and a speaker test tone. Tones are
// synthesized with WebAudio (no asset files) and routed to the user's preferred
// output device so the speaker test actually exercises the chosen speaker.
import { getPreferredOutput } from './audio.js';

let ctx = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// Play a sequence of [frequency, durationSeconds] tones to the preferred output.
async function playTones(tones, { volume = 0.14 } = {}) {
  try {
    const c = audioCtx();
    if (c.state === 'suspended') await c.resume();
    const dest = c.createMediaStreamDestination();
    const master = c.createGain();
    master.gain.value = volume;
    master.connect(dest);

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

    const el = new Audio();
    el.srcObject = dest.stream;
    el.autoplay = true;
    const out = getPreferredOutput();
    if (out && typeof el.setSinkId === 'function') {
      await el.setSinkId(out).catch(() => {});
    }
    await el.play().catch(() => {});
    // Release the element once the sequence has finished.
    const ms = (t - c.currentTime) * 1000 + 300;
    setTimeout(() => {
      el.srcObject = null;
    }, ms);
  } catch {
    /* sounds are best-effort */
  }
}

// You connected / disconnected.
export const playSelfJoin = () => playTones([[523.25, 0.09], [783.99, 0.13]]); // C5 → G5
export const playSelfLeave = () => playTones([[783.99, 0.09], [523.25, 0.13]]); // G5 → C5
// Someone else joined / left your channel (softer, distinct interval).
export const playPeerJoin = () => playTones([[587.33, 0.07], [739.99, 0.1]], { volume: 0.1 }); // D5 → F#5
export const playPeerLeave = () => playTones([[587.33, 0.07], [440.0, 0.1]], { volume: 0.1 }); // D5 → A4
// Speaker test: a friendly two-note tone, a touch louder.
export const playTestTone = () => playTones([[440, 0.16], [660, 0.18]], { volume: 0.2 });
