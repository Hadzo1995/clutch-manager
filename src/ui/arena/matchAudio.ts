/**
 * Match sounds: recorded gunfire on each kill, plus synthesized cues: a headshot ping, the plant
 * chirp, the bomb's accelerating beep, defuse and detonation, and a short sting when the round ends
 * (bright for a win, low for a loss). Quiet by design; muted state persists per viewer.
 *
 * Gunshots are field recordings from "The Free Firearm Sound Library" (CC0), trimmed to the shot
 * and its tail: AK-47 for the AK and Galil, AR-15 for the M4s and FAMAS, Walther PPQ for pistols,
 * PPSh for SMGs and a .30-06 bolt-action rifle for the AWP. Silenced guns (M4A1-S, USP-S) play the
 * same recording through a low-pass filter. Until the files are decoded, the synthesized shot plays.
 */
import rifleUrl from './assets/sounds/rifle.mp3?url';
import carbineUrl from './assets/sounds/carbine.mp3?url';
import pistolUrl from './assets/sounds/pistol.mp3?url';
import smgUrl from './assets/sounds/smg.mp3?url';
import sniperUrl from './assets/sounds/sniper.mp3?url';

type GunKind = 'rifle' | 'carbine' | 'pistol' | 'smg' | 'sniper';
const GUN_URLS: Record<GunKind, string> = { rifle: rifleUrl, carbine: carbineUrl, pistol: pistolUrl, smg: smgUrl, sniper: sniperUrl };

/** How each weapon sounds: which recording, how many shots per kill and their spacing, and tweaks. */
function gunProfile(weapon: string): { kind: GunKind; shots: number; gap: number; rate: number; muffled: boolean; gain: number } {
  const w = weapon.toLowerCase();
  if (/awp|ssg|scout/.test(w)) return { kind: 'sniper', shots: 1, gap: 0, rate: 1, muffled: false, gain: 0.55 };
  if (/usp/.test(w)) return { kind: 'pistol', shots: 2, gap: 0.16, rate: 1.05, muffled: true, gain: 0.32 };
  if (/m4a1-s/.test(w)) return { kind: 'carbine', shots: 3, gap: 0.1, rate: 1.04, muffled: true, gain: 0.32 };
  if (/deagle|desert eagle|r8/.test(w)) return { kind: 'pistol', shots: 1, gap: 0, rate: 0.82, muffled: false, gain: 0.5 };
  if (/glock|p2000|p250|five|tec|cz|dual|berettas/.test(w)) return { kind: 'pistol', shots: 2, gap: 0.16, rate: 1, muffled: false, gain: 0.38 };
  if (/mp9|mac|mp7|mp5|ump|p90|bizon/.test(w)) return { kind: 'smg', shots: 4, gap: 0.075, rate: 1.05, muffled: false, gain: 0.32 };
  if (/m4a4|famas|aug/.test(w)) return { kind: 'carbine', shots: 3, gap: 0.095, rate: 1, muffled: false, gain: 0.38 };
  return { kind: 'rifle', shots: 3, gap: 0.1, rate: 1, muffled: false, gain: 0.4 };
}
const KEY = 'clutch-manager.match-sound';
export const matchSoundOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setMatchSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

let shared: ReturnType<typeof make> | null = null;
/** One audio graph for the whole match flow (browsers cap the number of contexts). */
export function matchAudio() { return (shared ??= make()); }

function make() {
  let ctx: AudioContext | null = null;
  try { ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { ctx = null; }
  if (!ctx) { const nop = () => {}; return { shot: nop, headshot: nop, plant: nop, beep: nop, defuse: nop, explode: nop, roundStart: nop, roundEnd: nop, resume: nop }; }
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(ac.destination);
  const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const env = (g: GainNode, s: number, peak: number, attack: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(peak, s + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  };
  const tone = (freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) => {
    const o = ac.createOscillator(), g = ac.createGain(), s = ac.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(freq, s);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, s + dur);
    env(g, s, gain, 0.004, dur);
    o.connect(g).connect(master); o.start(s); o.stop(s + dur + 0.05);
  };
  // Recorded gunshots, decoded in the background; the synthesized shot covers the gap.
  const guns = new Map<GunKind, AudioBuffer>();
  for (const k of Object.keys(GUN_URLS) as GunKind[]) {
    fetch(GUN_URLS[k]).then((r) => r.arrayBuffer()).then((d) => ac.decodeAudioData(d)).then((b) => { guns.set(k, b); }).catch(() => { /* keep the synth for this one */ });
  }
  const sample = (buf: AudioBuffer, at: number, gain: number, rate: number, pan: number, muffled: boolean) => {
    const src = ac.createBufferSource(), g = ac.createGain(), s = ac.currentTime + at;
    src.buffer = buf;
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    g.gain.value = gain * (0.9 + Math.random() * 0.2);
    let out: AudioNode = src;
    if (muffled) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 0.5; out = out.connect(f); }
    out = out.connect(g);
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; out = out.connect(p); }
    out.connect(master);
    src.start(s);
  };
  const burst = (at: number, dur: number, gain: number, freq: number, type: BiquadFilterType = 'lowpass', pan = 0) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), s = ac.currentTime + at;
    src.buffer = noise; f.type = type; f.frequency.value = freq;
    env(g, s, gain, 0.002, dur);
    let out: AudioNode = src.connect(f).connect(g);
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; out = out.connect(p); }
    out.connect(master);
    src.start(s, Math.random()); src.stop(s + dur + 0.05);
  };
  return {
    resume: () => { if (ac.state === 'suspended') void ac.resume().catch(() => {}); },
    /** A shot; `pan` is -1..1 by which side of the screen the killer's team panel is on. */
    shot: (weapon: string, pan: number) => {
      const prof = gunProfile(weapon);
      const buf = guns.get(prof.kind);
      if (buf) {
        for (let i = 0; i < prof.shots; i++) sample(buf, i * prof.gap * (0.9 + Math.random() * 0.2), prof.gain, prof.rate, pan, prof.muffled);
        return;
      }
      const awp = /awp|ssg|scout/i.test(weapon);
      const pistol = /glock|usp|p2000|p250|deagle|five|tec|cz|dual/i.test(weapon);
      if (awp) { burst(0, 0.45, 0.5, 1800, 'lowpass', pan); tone(90, 0, 0.35, 0.3, 'sine', 40); burst(0.02, 0.6, 0.08, 600, 'bandpass', pan); return; }
      const n = pistol ? 1 : 3;
      for (let i = 0; i < n; i++) { burst(i * 0.085, 0.12, 0.32, pistol ? 3200 : 2400, 'lowpass', pan); tone(140, i * 0.085, 0.08, 0.14, 'triangle', 60); }
    },
    headshot: () => { tone(2600, 0.04, 0.12, 0.05, 'sine', 2200); tone(3900, 0.06, 0.1, 0.025, 'sine'); },
    plant: () => { [0, 0.12, 0.24].forEach((d) => tone(1500, d, 0.07, 0.06, 'square')); tone(700, 0.4, 0.3, 0.05, 'sine', 520); },
    beep: () => tone(2100, 0, 0.06, 0.05, 'square'),
    defuse: () => { tone(900, 0, 0.1, 0.06, 'square'); tone(1350, 0.12, 0.25, 0.06, 'square'); },
    explode: () => { burst(0, 1.8, 0.7, 700); tone(70, 0, 1.4, 0.45, 'sine', 28); burst(0.05, 1.2, 0.2, 3000, 'bandpass'); },
    roundStart: () => { burst(0, 0.5, 0.05, 900, 'bandpass'); tone(330, 0.05, 0.25, 0.04, 'triangle', 440); },
    roundEnd: (won: boolean) => {
      const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392, 311.13, 261.63];
      notes.forEach((f, k) => tone(f, k * 0.09, 0.7, 0.05, 'triangle'));
      tone(won ? 130.8 : 98, 0, 1.0, 0.06, 'sawtooth');
    },
  };
}
