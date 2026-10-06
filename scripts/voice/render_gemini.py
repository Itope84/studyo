#!/usr/bin/env python3
"""Prototype: render a narrate script (skills/narrate) with Gemini TTS.

  python3 scripts/voice/render_gemini.py script.json out.m4a [--model gemini-3.8-flash-tts]
      [--host Charon] [--cohost Aoede] [--style "..."] [--chunk 8] [--limit N]

Reads GEMINI_API_KEY from the environment (load .env first). Two-voice scripts use
Gemini's multi-speaker mode, one request per chunk of turns; one-voice scripts use
a single speaker. The style direction is plain English put in front of the text.
Each request's trailing noise burst is trimmed (clean_tail.py) and requests are cached so a retry resumes.
"""
import argparse, base64, hashlib, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, wave
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from clean_tail import clean_chunk

SR = 24000
ap = argparse.ArgumentParser()
ap.add_argument("script"); ap.add_argument("out")
ap.add_argument("--model", default="gemini-3.8-flash-tts")
ap.add_argument("--narrator", default="Charon")
ap.add_argument("--host", default="Charon")
ap.add_argument("--cohost", default="Aoede")
ap.add_argument("--chunk-chars", type=int, default=2200, help="max characters of text per request")
ap.add_argument("--tags", action="store_true", help="prefix turns with [tone] tags")
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--part", type=int, default=0, help="only this part number")
ap.add_argument("--split", action="store_true", help="also write <out>.partN.m4a per part")
ap.add_argument("--style", default=(
    "Two friends having a relaxed, curious conversation about something they find interesting. "
    "Natural speech, not a presenter and not a voiceover: varied pace, small hesitations, "
    "real reactions, warmth. The host explains plainly and slows down on the key idea. "
    "The co-host sounds genuinely curious and asks like someone who wants to know."))
a = ap.parse_args()
KEY = os.environ["GEMINI_API_KEY"]

script = json.load(open(a.script))
segs = script["segments"][: a.limit or None]
two = script.get("voices", 1) == 2
names = {"narrator": "Narrator", "host": "Host", "cohost": "Cohost"}

TAGS = {"curious": "[curious] ", "serious": "[serious] ", "playful": "[playful] ", "surprised": "[surprised] ",
        "reflective": "[thoughtful] ", "emphatic": "[emphatic] ", "warm": "[warm] "}
def tag(seg):
    return TAGS.get(seg.get("tone"), "") if a.tags else ""

def call(parts, voice_cfg):
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": voice_cfg}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{a.model}:generateContent"
    for attempt in range(8):
        req = urllib.request.Request(url, json.dumps(body).encode(),
                                     {"Content-Type": "application/json", "x-goog-api-key": KEY})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=300))
            part = r["candidates"][0]["content"]["parts"][0]["inlineData"]
            return base64.b64decode(part["data"])
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 503):
                wait = 20 * (attempt + 1)
                print(f"  HTTP {e.code}, waiting {wait}s: {msg[:120]}", file=sys.stderr); time.sleep(wait); continue
            raise SystemExit(f"HTTP {e.code}: {msg}")
        except (KeyError, IndexError):
            print("  no audio in reply, retrying", file=sys.stderr); time.sleep(5)
    raise SystemExit("gave up")

if two:
    cfg = {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
        {"speaker": "Host", "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": a.host}}},
        {"speaker": "Cohost", "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": a.cohost}}}]}}
else:
    cfg = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": a.narrator}}}

cache = a.out + ".cache"
os.makedirs(cache, exist_ok=True)
GAP = np.zeros(int(SR * 0.9), dtype="float32")

def chunks_of(group):
    cur, n = [], 0
    for seg in group:
        if cur and n + len(seg["text"]) > a.chunk_chars:
            yield cur; cur, n = [], 0
        cur.append(seg); n += len(seg["text"])
    if cur: yield cur

def render_chunk(group):
    if two:
        parts = [{"text": tag(s) + s["text"], "speechMetadata": {"speaker": names[s["speaker"]]}} for s in group]
    else:
        parts = [{"text": a.style + "\n\n" + " ".join(s["text"] for s in group)}]
    key = hashlib.sha1(json.dumps([a.model, parts, cfg], sort_keys=True).encode()).hexdigest()[:16]
    f = os.path.join(cache, key + ".pcm")
    if os.path.exists(f):
        raw = open(f, "rb").read()
    else:
        raw = call(parts, cfg)
        open(f, "wb").write(raw)
    x = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
    x, cut = clean_chunk(x, SR)
    return x, cut

def write_m4a(x, path):
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        with wave.open(f.name, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f.name, "-c:a", "aac", "-b:a", "64k", path], check=True)

t0 = time.time()
by_part = {}
for s in segs:
    by_part.setdefault(s.get("part", 1), []).append(s)
whole, timings, pos = [], [], 0.0
for n, group in sorted(by_part.items()):
    if a.part and n != a.part: continue
    audio = []
    for k, ch in enumerate(chunks_of(group), 1):
        x, cut = render_chunk(ch)
        words = sum(len(s["text"].split()) for s in ch)
        ratio = (len(x) / SR) / (words / 2.3)   # ~140 wpm; <0.7 or >1.5 suggests a cut-off or a stall
        flag = "  <-- CHECK LENGTH" if not 0.7 <= ratio <= 1.5 else ""
        audio += [x, GAP]
        print(f"part {n} chunk {k}: {len(x)/SR:.0f}s for {words} words, ratio {ratio:.2f} (trimmed {cut:.2f}s){flag}", file=sys.stderr, flush=True)
    px = np.concatenate(audio)
    timings.append({"part": n, "start": round(pos, 1), "end": round(pos + len(px) / SR, 1)})
    pos += len(px) / SR
    whole.append(px)
    if a.split: write_m4a(px, f"{a.out}.part{n}.m4a")
out = np.concatenate(whole)
write_m4a(out, a.out)
json.dump(timings, open(a.out + ".timings.json", "w"))
print(f"audio {len(out)/SR/60:.1f} min, rendered in {time.time()-t0:.0f}s", file=sys.stderr)
