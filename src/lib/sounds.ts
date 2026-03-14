let audioCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playToneSequence(
  frequencies: number[],
  durations: number[],
  volume: number,
) {
  const ctx = getContext();
  const now = ctx.currentTime;
  let offset = 0;

  for (let i = 0; i < frequencies.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequencies[i];
    gain.gain.setValueAtTime(volume * 0.15, now + offset);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      now + offset + durations[i],
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + durations[i]);
    offset += durations[i] * 0.7;
  }
}

/** Completion chime — ascending two-tone */
export function playChime(volume = 0.5) {
  playToneSequence([523, 659], [0.15, 0.2], volume);
}

/** Error alert — descending tone */
export function playAlert(volume = 0.5) {
  playToneSequence([440, 330], [0.12, 0.18], volume);
}

/** Needs input — single warm tone */
export function playTone(volume = 0.5) {
  playToneSequence([587], [0.25], volume);
}
