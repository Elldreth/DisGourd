// Audio device preferences, stored in the app (localStorage) independently of
// the OS default. Empty string means "use the system default".
const MIC_KEY = 'disgourd.audioInput';
const SPK_KEY = 'disgourd.audioOutput';

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
