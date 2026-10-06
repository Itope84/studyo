#!/usr/bin/env python3
"""Prototype: render a narrate script (skills/narrate) to audio with Kokoro, locally.

  uv run --python 3.12 --with kokoro --with soundfile --with numpy \
      scripts/voice/render_kokoro.py script.json out.m4a [--voice af_heart]

Pauses are silence inserted between segments; tone and pace become a speed.
Kokoro has no emotion control, so tone only nudges speed. Writes <out>.timings.json.
"""
import argparse, json, subprocess, sys, tempfile, time
import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
PAUSE_MS = {"none": 0, "short": 350, "medium": 750, "long": 1300}
PACE = {"slow": 0.88, "normal": 1.0, "fast": 1.1}
TONE = {"serious": 0.96, "reflective": 0.95, "emphatic": 0.96, "playful": 1.03, "surprised": 1.02}

ap = argparse.ArgumentParser()
ap.add_argument("script"); ap.add_argument("out")
ap.add_argument("--voice", default="af_heart", help="narrator (one voice)")
ap.add_argument("--host", default="am_michael")
ap.add_argument("--cohost", default="af_bella")
ap.add_argument("--base-speed", type=float, default=1.0)
ap.add_argument("--limit", type=int, default=0, help="only the first N segments")
a = ap.parse_args()

script = json.load(open(a.script))
segs = script["segments"][: a.limit or None]
pipe = KPipeline(lang_code="a")
VOICE = {"narrator": a.voice, "host": a.host, "cohost": a.cohost}

audio, timings, t0 = [], [], time.time()
pos = 0
for s in segs:
    speed = a.base_speed * PACE[s.get("pace", "normal")] * TONE.get(s.get("tone", "neutral"), 1.0)
    parts = [np.asarray(x[2]) for x in pipe(s["text"], voice=VOICE[s.get("speaker", "narrator")], speed=speed)]
    wav = np.concatenate(parts)
    gap = np.zeros(int(SR * PAUSE_MS[s.get("pause_after", "short")] / 1000), dtype=wav.dtype)
    timings.append({"id": s["id"], "start": round(pos / SR, 2), "end": round((pos + len(wav)) / SR, 2)})
    audio += [wav, gap]
    pos += len(wav) + len(gap)
    print(f'{s["id"]} {len(wav)/SR:5.1f}s', file=sys.stderr)

out = np.concatenate(audio)
with tempfile.NamedTemporaryFile(suffix=".wav") as f:
    sf.write(f.name, out, SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f.name, "-c:a", "aac", "-b:a", "64k", a.out], check=True)
json.dump(timings, open(a.out + ".timings.json", "w"))
print(f"audio {len(out)/SR:.0f}s, rendered in {time.time()-t0:.0f}s", file=sys.stderr)
