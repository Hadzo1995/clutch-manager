/**
 * Effects for the case opening: synthesized sound (no audio files) and a canvas particle layer.
 * Everything scales with the drop's tier, so a Legend pull is louder, brighter and longer than a Bronze one.
 */
import { useEffect, useRef, useState } from 'react';
import type { Rarity } from '../../engine/types';

export const TIER: Record<Rarity, number> = { bronze: 0, silver: 1, gold: 2, elite: 3, legend: 4 };
export const RARITY_HEX: Record<Rarity, string> = { bronze: '#c08552', silver: '#a9b6c4', gold: '#e3b23c', elite: '#49b6ff', legend: '#d46cff' };

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type CaseAudio = ReturnType<typeof caseAudio>;

export function caseAudio() {
  let ctx: AudioContext | null = null;
  try { ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { ctx = null; }
  if (!ctx) {
    const nop = () => {};
    return { drop: nop, latch: nop, burst: nop, tick: nop, riser: nop, land: nop, reveal: nop, close: nop };
  }
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp).connect(ac.destination);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const t0 = () => ac.currentTime;

  const env = (g: GainNode, at: number, peak: number, attack: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  };
  const tone = (freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number, attack = 0.005) => {
    const o = ac.createOscillator(), g = ac.createGain();
    const s = t0() + at;
    o.type = type; o.frequency.setValueAtTime(freq, s);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, s + dur);
    env(g, s, gain, attack, dur);
    o.connect(g).connect(master);
    o.start(s); o.stop(s + dur + 0.05);
  };
  const hiss = (at: number, dur: number, gain: number, from: number, to: number, q = 1.2, attack = 0.01) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    const s = t0() + at;
    src.buffer = noise; src.loop = true;
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, s); f.frequency.exponentialRampToValueAtTime(to, s + dur);
    env(g, s, gain, attack, dur);
    src.connect(f).connect(g).connect(master);
    src.start(s); src.stop(s + dur + 0.05);
  };
  const boom = (at: number, gain: number, dur = 0.7) => { tone(110, at, dur, gain, 'sine', 38); hiss(at, 0.12, gain * 0.5, 900, 200, 0.8); };
  const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093];

  return {
    /** The case lands on the pedestal. */
    drop: () => { hiss(0, 0.45, 0.05, 300, 1600, 0.7, 0.3); boom(0.42, 0.28, 0.4); },
    /** One latch snapping open. */
    latch: (i: number) => { hiss(0, 0.05, 0.22, 4000, 2500, 2); tone(880 + i * 120, 0, 0.08, 0.06, 'square'); },
    /** The lid blowing off and light pouring out. */
    burst: () => { boom(0, 0.3, 0.5); hiss(0, 0.7, 0.12, 400, 6000, 0.9, 0.04); tone(220, 0.02, 0.6, 0.06, 'triangle', 880); },
    /** An item crossing the line; pitch rises slightly with speed. */
    tick: (speed: number) => { tone(1900 + Math.min(1, speed) * 700 + Math.random() * 120, 0, 0.022, 0.05, 'square'); },
    /** Suspense for Gold and above while the winning slot glows. */
    riser: (tier: number) => { tone(220, 0, 1.0, 0.05, 'sawtooth', 220 * Math.pow(2, 1 + tier / 2), 0.4); hiss(0, 1.0, 0.05, 500, 5000, 1, 0.6); },
    /** The reel snaps into place. */
    land: () => { hiss(0, 0.06, 0.18, 2000, 900, 1.5); tone(330, 0, 0.12, 0.08, 'triangle'); },
    /** Fanfare for the card itself. */
    reveal: (tier: number) => {
      const n = 2 + tier;
      NOTES.slice(0, n).forEach((f, k) => tone(f, k * 0.075, 0.9 + tier * 0.15, 0.06, 'triangle'));
      if (tier >= 2) NOTES.slice(0, 3).forEach((f) => tone(f / 2, 0, 1.6 + tier * 0.3, 0.035, 'sawtooth', undefined, 0.08));
      if (tier >= 3) { boom(0, 0.38, 1.0); hiss(0, 1.2, 0.08, 8000, 2500, 0.7, 0.02); }
      if (tier >= 4) for (let k = 0; k < 10; k++) tone(NOTES[3 + (k % 4)]! * 2, 0.5 + k * 0.11 + Math.random() * 0.05, 0.35, 0.03, 'sine');
    },
    close: () => { void ac.close().catch(() => {}); },
  };
}

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 0 | 1 | 2; rot: number; vr: number }

/**
 * A full-bleed canvas of sparks (streaks), confetti and rising embers. `burst` changes trigger a new
 * explosion from the origin (fractions of the box). Embers keep drifting while `embers` is on.
 */
export function Sparks({ burst, tier, colors, origin = [0.5, 0.45], embers = false, className = '' }: {
  burst: number; tier: number; colors: string[]; origin?: [number, number]; embers?: boolean; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const parts = useRef<P[]>([]);
  const run = useRef<{ raf: number; embers: boolean }>({ raf: 0, embers });
  run.current.embers = embers;
  const [reduced] = useState(prefersReducedMotion);

  const loop = () => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (run.current.embers && Math.random() < 0.5) {
        parts.current.push({ x: Math.random() * w, y: h + 6, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 60, life: 0, max: 2.5 + Math.random() * 2, size: 1 + Math.random() * 2.2, color: colors[Math.floor(Math.random() * colors.length)] ?? '#fff', kind: 2, rot: 0, vr: 0 });
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const ps = parts.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!;
        p.life += dt;
        if (p.life >= p.max) { ps.splice(i, 1); continue; }
        const k = 1 - p.life / p.max;
        if (p.kind === 0) { p.vy += 380 * dt; p.vx *= 0.985; p.vy *= 0.985; }
        else if (p.kind === 1) { p.vy += 160 * dt; p.vx *= 0.97; p.vy = Math.min(p.vy, 140); p.rot += p.vr * dt; }
        else { p.vx += Math.sin(now / 300 + p.y) * 4 * dt; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalAlpha = Math.min(1, k * 1.6);
        if (p.kind === 0) {
          g.globalCompositeOperation = 'lighter';
          g.strokeStyle = p.color; g.lineWidth = p.size; g.lineCap = 'round';
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); g.stroke();
        } else if (p.kind === 1) {
          g.globalCompositeOperation = 'source-over';
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.rot * 2.3));
          g.fillStyle = p.color; g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          g.restore();
        } else {
          g.globalCompositeOperation = 'lighter';
          const r = p.size * 3;
          const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gr.addColorStop(0, p.color); gr.addColorStop(1, 'transparent');
          g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
        }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      if (ps.length || run.current.embers) run.current.raf = requestAnimationFrame(step);
      else run.current.raf = 0;
    };
    cancelAnimationFrame(run.current.raf);
    run.current.raf = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (reduced || !burst) return;
    const cv = ref.current;
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const ox = origin[0] * w, oy = origin[1] * h;
    const tt = Math.max(0, Math.min(4, tier));
    const sparks = [14, 30, 70, 130, 220][tt] ?? 30;
    const confetti = [0, 0, 30, 70, 140][tt] ?? 0;
    const pick = () => colors[Math.floor(Math.random() * colors.length)] ?? '#fff';
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * (260 + tier * 120);
      parts.current.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0, max: 0.6 + Math.random() * (0.6 + tier * 0.25), size: 1 + Math.random() * 1.8, color: Math.random() < 0.3 ? '#fff' : pick(), kind: 0, rot: 0, vr: 0 });
    }
    for (let i = 0; i < confetti; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 220 + Math.random() * 420;
      parts.current.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 2 + Math.random() * 1.6, size: 3 + Math.random() * 3, color: Math.random() < 0.2 ? '#fff' : pick(), kind: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
    }
    loop();
  }, [burst]);

  useEffect(() => () => cancelAnimationFrame(run.current.raf), []);

  if (reduced) return null;
  return <canvas ref={ref} className={`fx-sparks ${className}`} aria-hidden="true" />;
}

/** Counts up to `to` after `delay` ms; lands exactly on the value. */
export function useCountUp(to: number, ms: number, delay: number, on: boolean): number {
  const [v, setV] = useState(on && !prefersReducedMotion() ? 0 : to);
  useEffect(() => {
    if (!on || prefersReducedMotion()) { setV(to); return; }
    let raf = 0;
    const start = performance.now() + delay;
    const f = (now: number) => {
      const x = Math.max(0, Math.min(1, (now - start) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - x, 3))));
      if (x < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, delay, on]);
  return v;
}
