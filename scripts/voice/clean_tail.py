"""Remove the loud noise burst Gemini TTS leaves at the end of each request.

clean_chunk(x, sr): x is one request's audio as float32 in [-1, 1]. If the audio ends with
quiet followed by a short burst far louder than speech, cut from just after the speech.
"""
import numpy as np

def clean_chunk(x, sr=24000, burst_rms=0.3, quiet_rms=0.02, max_burst_s=0.7):
    f = int(sr * 0.02)
    n = len(x) // f
    r = np.sqrt(np.mean(x[: n * f].reshape(n, f) ** 2, axis=1))
    i = n - 1
    while i >= 0 and r[i] < 0.002:          # trailing digital silence
        i -= 1
    end = i + 1
    j = end
    while j > 0 and r[j - 1] >= quiet_rms:  # trailing burst frames
        j -= 1
    if end - j == 0 or (end - j) * 0.02 > max_burst_s or r[j:end].max() < burst_rms:
        return x, 0.0
    k = j
    while k > 0 and r[k - 1] < quiet_rms:   # the quiet run before the burst
        k -= 1
    if (j - k) * 0.02 < 0.1:
        return x, 0.0
    cut = min(j, k + 8) * f                 # keep ~160 ms of the quiet
    y = x[:cut].copy()
    fade = min(len(y), int(sr * 0.02))
    y[-fade:] *= np.linspace(1, 0, fade)
    return y, (len(x) - len(y)) / sr
