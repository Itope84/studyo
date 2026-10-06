/**
 * Gemini TTS ends every request with a short, very loud burst of noise (about 0.5 RMS against about 0.15 for
 * speech). Cut it: if the audio ends in quiet followed by a short burst far louder than speech, stop just after the
 * quiet starts. Works on one request's audio as float samples in [-1, 1].
 */
export function cleanTail(
  x: Float32Array,
  sampleRate: number,
  opts: { burstRms?: number; quietRms?: number; maxBurstSeconds?: number } = {},
): { audio: Float32Array; trimmedSeconds: number } {
  const burstRms = opts.burstRms ?? 0.3;
  const quietRms = opts.quietRms ?? 0.02;
  const maxBurst = opts.maxBurstSeconds ?? 0.7;
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const n = Math.floor(x.length / frame);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += (x[i] as number) ** 2;
    rms[f] = Math.sqrt(sum / frame);
  }
  const unchanged = { audio: x, trimmedSeconds: 0 };
  let end = n;
  while (end > 0 && (rms[end - 1] as number) < 0.002) end--; // trailing digital silence
  let burstStart = end;
  while (burstStart > 0 && (rms[burstStart - 1] as number) >= quietRms) burstStart--;
  const burstFrames = end - burstStart;
  if (burstFrames === 0 || burstFrames * 0.02 > maxBurst) return unchanged;
  let peak = 0;
  for (let f = burstStart; f < end; f++) peak = Math.max(peak, rms[f] as number);
  if (peak < burstRms) return unchanged;
  let quietStart = burstStart;
  while (quietStart > 0 && (rms[quietStart - 1] as number) < quietRms) quietStart--;
  if ((burstStart - quietStart) * 0.02 < 0.1) return unchanged;
  const cut = Math.min(burstStart, quietStart + 8) * frame; // keep about 160 ms of the quiet
  const audio = x.slice(0, cut);
  const fade = Math.min(audio.length, Math.round(sampleRate * 0.02));
  for (let i = 0; i < fade; i++) {
    const k = audio.length - fade + i;
    audio[k] = (audio[k] as number) * (1 - i / fade);
  }
  return { audio, trimmedSeconds: (x.length - audio.length) / sampleRate };
}
