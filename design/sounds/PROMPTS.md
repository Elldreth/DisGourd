# DisGourd UI sounds

Generated 2026-10-20 with kie.ai's Suno "Generate sounds" (`ai-music-api/sounds`, model `V6_MINI`, `sound_loop: false`): two takes per request, 2.5 credits per request, 15 credits for the set.

- `raw/`: the downloads as kie.ai returned them (MP3, about 2 s each; the "pop" prompts came back as short rhythmic sequences).
- `takes/`: every take cut to its first event and encoded to Ogg/Opus, 32 kb/s, 48 kHz mono, using `tools/trim_sounds.py`.
  - The cut runs from the onset until the level stays 30 dB under the event's peak for 60 ms. It is capped at 1.0 s for the chimes and 0.4–0.45 s for the pops.
  - The last 25% fades out, and each take is peak-normalised: chimes to −6 dBFS, pops to −9 dBFS.
- `web/public/sounds/`: the chosen take for each event, renamed. All six total about 19 KB.
- `tools/kie_sounds.py`: makes the requests. It reads `KIEAI_API_KEY` from the repo-root `.env` and never prints it.

The app plays these through `web/src/sounds.js` at a per-sound gain (0.5 for the chimes, 0.4 for someone else joining or leaving, 0.35 for the message pop). If a file can't load, it falls back to the old synthesized tones.

| Event | File | Chosen take | Prompt |
|---|---|---|---|
| You join a voice channel; also the speaker test | `join.ogg` | `join-1` | Short bright two-note rising chime, soft marimba with a touch of glass, friendly UI sound for joining a voice call. Clean, dry, under one second, no music, no drums. |
| You leave a voice channel | `leave.ogg` | `leave-1` | Short two-note falling chime, soft marimba with a touch of glass, gentle UI sound for leaving a voice call. Clean, dry, under one second, no music, no drums. |
| Someone joins your channel | `peer-join.ogg` | `peer-join-2` (take 1 is too quiet and short) | A single very soft wooden pop with a slight upward pitch, subtle UI blip when someone joins a call. Dry, very short, quiet. |
| Someone leaves your channel | `peer-leave.ogg` | `peer-leave-1` | A single very soft wooden pop with a slight downward pitch, subtle UI blip when someone leaves a call. Dry, very short, quiet. |
| A mention or a DM | `mention.ogg` | `mention-2` | Bright pleasant two-note bell ding, warm notification sound for a direct message or mention. Short, clear, not harsh, no music. |
| Any new message ("All messages" level) | `message.ogg` | `message-1` | A tiny soft bubble pop, quiet UI tick for a new chat message. Extremely short, dry, gentle. |

To swap a take, copy it from `takes/` over the file in `web/public/sounds/`.
