"""Cut each raw kie.ai take down to one UI-length event and encode it (P5-06).
python trim_sounds.py <raw_dir> <out_dir>
For every take: decode to 48 kHz mono PCM, find the first event (from the
onset until the level stays 30 dB under that event's peak for 60 ms),
cap it (chimes 1.0 s, pops 0.4 s), fade the last 25% out, then peak-normalise
and encode to Ogg/Opus at 32 kb/s. Prints a report.
"""
import array, math, os, subprocess, sys, json

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SR = 48000
FRAME = SR // 100  # 10 ms
CAP = {'join': 1.0, 'leave': 1.0, 'mention': 1.0, 'message': 0.4, 'peer-join': 0.45, 'peer-leave': 0.45, 'report': 0.8, 'group': 0.9}
# Peak targets in dBFS (loudness normalisation misbehaves on clips this short):
# chimes -6, the small pops -9. The app's playback gain sets the final level.
PEAK = {'join': -6, 'leave': -6, 'mention': -6, 'message': -9, 'peer-join': -9, 'peer-leave': -9, 'report': -6, 'group': -6}


def pcm(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    a = array.array('h')
    a.frombytes(raw)
    return a


def env_db(a):
    out = []
    for i in range(0, len(a) - FRAME, FRAME):
        s = 0
        for v in a[i:i + FRAME]:
            s += v * v
        rms = math.sqrt(s / FRAME) / 32768
        out.append(20 * math.log10(rms) if rms > 0 else -120)
    return out


report = {}
for f in sorted(os.listdir(RAW)):
    if not f.endswith('.mp3'):
        continue
    name = f[:-4]
    kind = name.rsplit('-', 1)[0]
    e = env_db(pcm(os.path.join(RAW, f)))
    onset = next((i for i, v in enumerate(e) if v > -45), 0)
    peak = onset
    end = onset
    quiet = 0
    for i in range(onset, len(e)):
        if e[i] > e[peak]:
            peak = i
        if e[i] < e[peak] - 30:
            quiet += 1
            if quiet >= 6:
                end = i - 5
                break
        else:
            quiet = 0
        end = i
    start_s = max(0, onset - 1) / 100
    length = min((end - onset + 1) / 100 + 0.02, CAP[kind])
    fade = round(length * 0.25, 3)
    dst = os.path.join(OUT, f'{name}.ogg')
    cut = f'atrim=start={start_s}:duration={length},asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st={round(length - fade, 3)}:d={fade}'
    stats = subprocess.run(['ffmpeg', '-hide_banner', '-i', os.path.join(RAW, f), '-ac', '1', '-af', cut + ',astats', '-f', 'null', '-'], capture_output=True, text=True).stderr
    peak_db = float([l for l in stats.splitlines() if 'Peak level dB' in l][-1].split(':')[-1])
    gain = PEAK[kind] - peak_db
    af = f'{cut},volume={gain:.2f}dB,aresample=48000'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(RAW, f), '-ac', '1', '-af', af, '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'audio', dst], check=True)
    size = os.path.getsize(dst)
    report[name] = {'start': start_s, 'length': round(length, 2), 'event_peak_db': round(e[peak], 1), 'natural_end_s': round((end + 1) / 100, 2), 'bytes': size}
    print(f'{name:14} start={start_s:.2f}s len={length:.2f}s peak={e[peak]:.1f}dB natural_end={(end + 1) / 100:.2f}s -> {size} B')
json.dump(report, open(os.path.join(OUT, 'trim-report.json'), 'w'), indent=2)
