"""Generate DisGourd UI sounds with kie.ai's Suno "Generate sounds" (P5-06).
Reads KIEAI_API_KEY from the repo's .env; never prints it.
Usage: python kie_sounds.py credits | python kie_sounds.py gen <outdir> [name ...]
"""
import json, sys, time, urllib.request, os

ENV = r'H:\repos\DisGourd\.env'
KEY = None
for line in open(ENV, encoding='utf-8'):
    if line.strip().startswith('KIEAI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
assert KEY, 'no key'
BASE = 'https://api.kie.ai'

PROMPTS = {
    'join': 'Short bright two-note rising chime, soft marimba with a touch of glass, friendly UI sound for joining a voice call. Clean, dry, under one second, no music, no drums.',
    'leave': 'Short two-note falling chime, soft marimba with a touch of glass, gentle UI sound for leaving a voice call. Clean, dry, under one second, no music, no drums.',
    'peer-join': 'A single very soft wooden pop with a slight upward pitch, subtle UI blip when someone joins a call. Dry, very short, quiet.',
    'peer-leave': 'A single very soft wooden pop with a slight downward pitch, subtle UI blip when someone leaves a call. Dry, very short, quiet.',
    'mention': 'Bright pleasant two-note bell ding, warm notification sound for a direct message or mention. Short, clear, not harsh, no music.',
    'message': 'A tiny soft bubble pop, quiet UI tick for a new chat message. Extremely short, dry, gentle.',
    # P10-08
    'report': 'Soft low two-note wooden knock, a calm heads-up for a moderator that something needs a look. Short, warm, not alarming, no music, no drums.',
    'group': 'Short cheerful rising three-note pluck, light and bubbly, UI sound for being added to a group chat. Dry, under one second, no music, no drums.',
}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read())


def credits():
    print('credits:', req('GET', '/api/v1/chat/credit').get('data'))


def gen(outdir, names):
    os.makedirs(outdir, exist_ok=True)
    tasks = {}
    for n in names:
        res = req('POST', '/api/v1/jobs/createTask', {'model': 'ai-music-api/sounds', 'input': {'prompt': PROMPTS[n], 'model': 'V6_MINI', 'sound_loop': False}})
        if res.get('code') != 200:
            print(n, 'create failed:', res.get('code'), res.get('msg'))
            continue
        tasks[n] = res['data']['taskId']
        print(n, 'task created')
        time.sleep(1)
    deadline = time.time() + 600
    done = {}
    while tasks and time.time() < deadline:
        time.sleep(8)
        for n, tid in list(tasks.items()):
            d = req('GET', f'/api/v1/jobs/recordInfo?taskId={tid}').get('data') or {}
            st = d.get('state')
            if st == 'success':
                urls = []
                rj = d.get('resultJson')
                if rj:
                    try:
                        urls = json.loads(rj).get('resultUrls') or []
                    except Exception:
                        pass
                resp = d.get('response') or {}
                for clip in (resp.get('data') or []):
                    if clip.get('audio_url'):
                        urls.append(clip['audio_url'])
                urls = list(dict.fromkeys(urls))
                for i, u in enumerate(urls):
                    ext = os.path.splitext(u.split('?')[0])[1] or '.mp3'
                    path = os.path.join(outdir, f'{n}-{i + 1}{ext}')
                    urllib.request.urlretrieve(u, path)
                    print(n, 'saved', path)
                print(n, 'credits', d.get('creditsConsumed'))
                done[n] = urls
                del tasks[n]
            elif st == 'fail':
                print(n, 'failed:', d.get('failCode'), d.get('failMsg'))
                del tasks[n]
    if tasks:
        print('timed out:', list(tasks))
    json.dump({'prompts': {n: PROMPTS[n] for n in names}, 'model': 'ai-music-api/sounds V6_MINI'}, open(os.path.join(outdir, 'request.json'), 'w'), indent=2)


if __name__ == '__main__':
    if sys.argv[1] == 'credits':
        credits()
    else:
        gen(sys.argv[2], sys.argv[3:] or list(PROMPTS))
