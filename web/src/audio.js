// Audio device preferences, stored in the app (localStorage) independently of
// the OS default. Empty string means "use the system default".
const MIC_KEY = 'disgourd.audioInput';
const SPK_KEY = 'disgourd.audioOutput';
const PTT_ON = 'disgourd.pttEnabled';
const PTT_KEY = 'disgourd.pttKey';
const SND_KEY = 'disgourd.voiceSounds';

export const getPreferredInput = () => localStorage.getItem(MIC_KEY) || '';
export const getPreferredOutput = () => localStorage.getItem(SPK_KEY) || '';

export function setPreferredInput(id) {
  if (id) localStorage.setItem(MIC_KEY, id);
  else localStorage.removeItem(MIC_KEY);
}
export function setPreferredOutput(id) {
  if (id) localStorage.setItem(SPK_KEY, id);
  else localStorage.removeItem(SPK_KEY);
}

// Push-to-talk: when enabled, the mic only transmits while the chosen key is
// held. pttKey is a KeyboardEvent.code (e.g. "Space", "KeyT", "Backquote").
export const getPttEnabled = () => localStorage.getItem(PTT_ON) === '1';
export function setPttEnabled(on) {
  if (on) localStorage.setItem(PTT_ON, '1');
  else localStorage.removeItem(PTT_ON);
}
export const getPttKey = () => localStorage.getItem(PTT_KEY) || '';
export function setPttKey(code) {
  if (code) localStorage.setItem(PTT_KEY, code);
  else localStorage.removeItem(PTT_KEY);
}

// Join/leave chimes. On by default.
export const getVoiceSounds = () => localStorage.getItem(SND_KEY) !== '0';
export function setVoiceSounds(on) {
  if (on) localStorage.removeItem(SND_KEY);
  else localStorage.setItem(SND_KEY, '0');
}

// Human-readable label for a KeyboardEvent.code, for the settings UI.
export function keyLabel(code) {
  if (!code) return 'none';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow/, '')
    .replace('Backquote', '` (backtick)')
    .replace('ControlLeft', 'Left Ctrl')
    .replace('ControlRight', 'Right Ctrl')
    .replace('ShiftLeft', 'Left Shift')
    .replace('ShiftRight', 'Right Shift')
    .replace('AltLeft', 'Left Alt')
    .replace('AltRight', 'Right Alt');
}

// Choosing an output device requires HTMLMediaElement.setSinkId (Chromium).
export function outputSelectionSupported() {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

// Build getUserMedia audio constraints honoring the preferred input device.
export function audioConstraints() {
  const id = getPreferredInput();
  return id ? { deviceId: { exact: id } } : true;
}

export async function listAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return { inputs: [], outputs: [], labeled: false };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  // Labels are only populated once the user has granted microphone access.
  const labeled = [...inputs, ...outputs].some((d) => d.label);
  return { inputs, outputs, labeled };
}

// Prompt for mic access so enumerateDevices() returns real device labels.
export async function unlockDeviceLabels() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

// Turn a getUserMedia failure into a specific, actionable message. The generic
// "needs HTTPS" line is only right for a genuinely insecure origin — most
// failures on localhost are a browser or OS permission block instead.
export function describeMicError(err) {
  const secure = typeof window === 'undefined' || window.isSecureContext;
  if (!secure) {
    return 'This page is not a secure origin, so the browser blocks the microphone. Open it via http://localhost, or set up HTTPS for network access.';
  }
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission is blocked. Click the camera/mic icon in the address bar and allow it, and check Windows Settings → Privacy & security → Microphone (turn on microphone access for desktop apps). Then reload.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Plug one in (or enable it in Windows sound settings) and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is in use or blocked by the system. Close other apps using it, check Windows microphone privacy settings, then try again.';
    case 'OverconstrainedError':
      return 'The selected microphone is unavailable. Pick a different device.';
    default:
      return `Could not access the microphone${err && err.name ? ` (${err.name})` : ''}. Check your browser and Windows microphone permissions.`;
  }
}
