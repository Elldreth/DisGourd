import { useEffect, useRef, useState } from 'react';
import {
  listAudioDevices,
  unlockDeviceLabels,
  getPreferredInput,
  setPreferredInput,
  getPreferredOutput,
  setPreferredOutput,
  outputSelectionSupported,
  describeMicError,
  getPttEnabled,
  setPttEnabled,
  getPttKey,
  setPttKey,
  getVoiceSounds,
  setVoiceSounds,
  keyLabel,
} from '../audio.js';
import { playTestTone } from '../sounds.js';

// Detect and choose the microphone and speaker DisGourd uses, independent of
// the OS default, with a mic level test.
export default function AudioSettings({ onOutputChange, onPttChange, onMicChange, inCall }) {
  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [labeled, setLabeled] = useState(false);
  const [mic, setMic] = useState(getPreferredInput());
  const [speaker, setSpeaker] = useState(getPreferredOutput());
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [pttOn, setPttOn] = useState(getPttEnabled());
  const [pttKey, setPttKeyState] = useState(getPttKey());
  const [recording, setRecording] = useState(false);
  const [sounds, setSounds] = useState(getVoiceSounds());
  const testRef = useRef(null);
  const outputSupported = outputSelectionSupported();

  async function refresh() {
    try {
      const d = await listAudioDevices();
      setInputs(d.inputs);
      setOutputs(d.outputs);
      setLabeled(d.labeled);
    } catch {
      setError('Could not list audio devices.');
    }
  }

  useEffect(() => {
    refresh();
    return () => stopTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enableLabels() {
    setError('');
    try {
      await unlockDeviceLabels();
      await refresh();
    } catch (err) {
      setError(describeMicError(err));
    }
  }

  function chooseMic(id) {
    setMic(id);
    setPreferredInput(id);
    if (testing) startTest(id); // restart the meter on the new device
    if (onMicChange) onMicChange(); // apply live if we're in a call
  }

  function chooseSpeaker(id) {
    setSpeaker(id);
    setPreferredOutput(id);
    if (onOutputChange) onOutputChange();
  }

  async function startTest(deviceId = mic) {
    stopTest();
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const timer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        setLevel(Math.min(100, Math.round((sum / data.length) * 2.5)));
      }, 100);
      testRef.current = { stream, ctx, timer };
      setTesting(true);
    } catch (err) {
      setError(describeMicError(err));
    }
  }

  function stopTest() {
    const t = testRef.current;
    if (t) {
      clearInterval(t.timer);
      t.stream.getTracks().forEach((x) => x.stop());
      if (t.ctx.close) t.ctx.close();
      testRef.current = null;
    }
    setTesting(false);
    setLevel(0);
  }

  function togglePtt() {
    const next = !pttOn;
    setPttOn(next);
    setPttEnabled(next);
    if (onPttChange) onPttChange();
  }

  function toggleSounds() {
    const next = !sounds;
    setSounds(next);
    setVoiceSounds(next);
  }

  // Record the next key press as the push-to-talk key.
  useEffect(() => {
    if (!recording) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setRecording(false);
        return;
      }
      setPttKey(e.code);
      setPttKeyState(e.code);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const micLabel = (d, i) => d.label || `Microphone ${i + 1}`;
  const spkLabel = (d, i) => d.label || `Speaker ${i + 1}`;

  return (
    <div className="space-y-3">
      {!labeled && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-3 py-2 text-sm text-gray-300">
          <span>Allow microphone access to see your device names.</span>
          <button
            onClick={enableLabels}
            className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
          >
            Enable
          </button>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
          Microphone
        </span>
        <select value={mic} onChange={(e) => chooseMic(e.target.value)} className="input">
          <option value="">System default</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {micLabel(d, i)}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Mic test</span>
          <button
            onClick={() => (testing ? stopTest() : startTest())}
            className={`rounded px-2 py-1 text-xs font-semibold ${
              testing ? 'bg-danger/80 text-white hover:bg-danger' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
            }`}
          >
            {testing ? 'Stop' : 'Test'}
          </button>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-900">
          <div className="h-full bg-online transition-[width] duration-100" style={{ width: `${level}%` }} />
        </div>
        {testing && <div className="mt-1 text-xs text-gray-500">Speak — the bar should move.</div>}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Speaker</span>
          <button
            onClick={() => playTestTone()}
            className="rounded bg-ink-600 px-2 py-1 text-xs font-semibold text-gray-200 hover:bg-ink-500"
          >
            Test
          </button>
        </div>
        <select
          value={speaker}
          onChange={(e) => chooseSpeaker(e.target.value)}
          disabled={!outputSupported}
          className="input disabled:opacity-60"
        >
          <option value="">System default</option>
          {outputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {spkLabel(d, i)}
            </option>
          ))}
        </select>
        {!outputSupported ? (
          <span className="mt-1 block text-xs text-gray-500">
            Your browser always uses the system default speaker. (Speaker choice works in Chrome/Edge.)
          </span>
        ) : (
          <span className="mt-1 block text-xs text-gray-500">
            Press Test to play a tone through the selected speaker.
          </span>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 pt-1">
        <span className="text-sm text-gray-200">
          Join/leave sounds
          <span className="block text-xs text-gray-500">A chime when people enter or leave the call.</span>
        </span>
        <input
          type="checkbox"
          checked={sounds}
          onChange={toggleSounds}
          className="h-4 w-4 accent-brand"
        />
      </label>

      <div className="rounded-lg bg-ink-900/60 p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-200">
            Push-to-talk
            <span className="block text-xs text-gray-500">
              Transmit only while holding a key (otherwise your mic is always live).
            </span>
          </span>
          <input type="checkbox" checked={pttOn} onChange={togglePtt} className="h-4 w-4 accent-brand" />
        </label>
        {pttOn && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setRecording((r) => !r)}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${
                recording ? 'bg-brand text-white' : 'bg-ink-600 text-gray-200 hover:bg-ink-500'
              }`}
            >
              {recording ? 'Press any key… (Esc cancels)' : 'Set key'}
            </button>
            <span className="text-sm text-gray-300">
              Key: <span className="font-semibold text-white">{keyLabel(pttKey)}</span>
            </span>
          </div>
        )}
        {pttOn && !pttKey && !recording && (
          <div className="mt-2 text-xs text-idle">Choose a key or you won't be able to talk.</div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Shortcuts (while the DisGourd window is focused): mute <kbd className="rounded bg-ink-700 px-1">Ctrl</kbd>+
          <kbd className="rounded bg-ink-700 px-1">Shift</kbd>+<kbd className="rounded bg-ink-700 px-1">M</kbd>, deafen{' '}
          <kbd className="rounded bg-ink-700 px-1">Ctrl</kbd>+<kbd className="rounded bg-ink-700 px-1">Shift</kbd>+
          <kbd className="rounded bg-ink-700 px-1">D</kbd>.
        </div>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}
      <p className="text-xs text-gray-500">
        {inCall
          ? 'Microphone and speaker changes apply immediately to your current call.'
          : 'Your microphone and speaker choices apply the next time you join a voice channel.'}
      </p>
    </div>
  );
}
