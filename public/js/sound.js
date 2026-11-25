// Tiny synthesized sound kit — no audio files to load.
let ctx = null;
let muted = localStorage.getItem('thirteen.muted') === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(dur, { freq = 2400, q = 0.8, gain = 0.25, delay = 0 } = {}) {
  const a = ac();
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
}

function tone(freq, dur, { type = 'sine', gain = 0.12, delay = 0, slide = 0 } = {}) {
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const kit = {
  select: () => noise(0.04, { freq: 3800, gain: 0.08 }),
  play: (n = 1) => { for (let i = 0; i < Math.min(n, 6); i++) noise(0.07, { freq: 2200 + Math.random() * 800, gain: 0.3, delay: i * 0.035 }); },
  pass: () => tone(220, 0.12, { type: 'triangle', gain: 0.06, slide: 0.8 }),
  turn: () => { tone(880, 0.18, { gain: 0.07 }); tone(1320, 0.25, { gain: 0.05, delay: 0.09 }); },
  chop: () => { tone(90, 0.5, { type: 'sawtooth', gain: 0.2, slide: 0.4 }); noise(0.3, { freq: 400, q: 0.5, gain: 0.6 }); },
  sweep: () => noise(0.25, { freq: 1200, q: 0.4, gain: 0.12 }),
  deal: () => { for (let i = 0; i < 13; i++) noise(0.05, { freq: 2600, gain: 0.12, delay: i * 0.045 }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.08, delay: i * 0.1 })),
  out: () => [659, 988].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.07, delay: i * 0.08 })),
  error: () => tone(160, 0.15, { type: 'square', gain: 0.04 }),
  chat: () => tone(1200, 0.08, { gain: 0.03 }),
};

export const sfx = new Proxy(kit, {
  get(t, k) {
    return (...args) => { if (!muted) try { t[k]?.(...args); } catch { /* audio not available */ } };
  },
});

export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  localStorage.setItem('thirteen.muted', muted ? '1' : '0');
  return muted;
}
