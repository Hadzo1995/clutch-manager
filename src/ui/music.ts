/**
 * Menu music, synthesized live with Web Audio (no audio files): a dark, slow electronic loop in A minor
 * with a pad, a pulsing bass, a soft kick and hats, and a delayed arpeggio. Eight bars, about 92 BPM.
 * Starts on the first click or key press (browsers block sound before that) and fades in and out.
 */
const KEY = 'clutch-manager.music';
export const musicOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
const store = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

const BPM = 92;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // sixteenth
// Am, F, C, G, Am, F, Dm, E (MIDI roots in the bass register, chord tones above).
const BARS: { root: number; chord: number[] }[] = [
  { root: 45, chord: [57, 60, 64] }, { root: 41, chord: [57, 60, 65] }, { root: 48, chord: [55, 60, 64] }, { root: 43, chord: [55, 59, 62] },
  { root: 45, chord: [57, 60, 64] }, { root: 41, chord: [57, 60, 65] }, { root: 38, chord: [57, 62, 65] }, { root: 40, chord: [56, 59, 64] },
];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const ARP = [0, 1, 2, 1, 2, 0, 1, 2];

class Music {
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;
  private delay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private step = 0;
  private next = 0;
  private wanted = false;
  private enabled = musicOn();

  get on() { return this.enabled; }

  /** Whether the current screen wants music (menus yes, live match no). */
  want(v: boolean) { this.wanted = v; this.sync(); }

  setEnabled(v: boolean) { this.enabled = v; store(v); this.sync(); }

  /** Re-check after the tab is hidden or shown. */
  refresh() { this.sync(); }

  /** Call from a user gesture: creates or resumes the audio context. */
  unlock() {
    if (!this.ac) {
      try { this.ac = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { this.ac = null; return; }
      this.build();
    }
    if (this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
    this.sync();
  }

  private build() {
    const ac = this.ac!;
    this.out = ac.createGain();
    this.out.gain.value = 0.0001;
    const comp = ac.createDynamicsCompressor();
    this.out.connect(comp).connect(ac.destination);
    this.delay = ac.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ac.createGain(); fb.gain.value = 0.38;
    const wet = ac.createGain(); wet.gain.value = 0.5;
    const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(wet).connect(this.out);
    this.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  private sync() {
    const ac = this.ac, out = this.out;
    if (!ac || !out) return;
    const play = this.enabled && this.wanted && !document.hidden;
    const now = ac.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
    if (play) {
      out.gain.exponentialRampToValueAtTime(0.42, now + 2.5);
      if (!this.timer) { this.next = now + 0.1; this.timer = window.setInterval(() => this.schedule(), 40); }
    } else {
      out.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      // Keep scheduling through the fade, then stop unless playback resumed meanwhile.
      window.setTimeout(() => { if (this.timer && !(this.enabled && this.wanted && !document.hidden)) { window.clearInterval(this.timer); this.timer = 0; } }, 1300);
    }
  }

  private schedule() {
    const ac = this.ac!;
    while (this.next < ac.currentTime + 0.15) { this.play(this.step, this.next); this.step = (this.step + 1) % (BARS.length * 16); this.next += STEP; }
  }

  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private play(step: number, t: number) {
    const ac = this.ac!, out = this.out!;
    const bar = BARS[Math.floor(step / 16)]!;
    const s = step % 16;
    // Pad: two detuned saws per chord tone through a soft low-pass, once per bar.
    if (s === 0) {
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1100, t + BEAT * 2); lp.frequency.linearRampToValueAtTime(600, t + BEAT * 4);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.9); g.gain.setValueAtTime(0.05, t + BEAT * 3.2); g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 4 + 0.6);
      lp.connect(g).connect(out);
      for (const m of bar.chord) for (const det of [-7, 7]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + BEAT * 4 + 0.7);
      }
    }
    // Bass on eighths, accented on the beat.
    if (s % 2 === 0) {
      const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = hz(bar.root); lp.type = 'lowpass'; lp.frequency.value = 420;
      this.env(g, t, s % 4 === 0 ? 0.16 : 0.09, 0.008, STEP * 1.6);
      o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + STEP * 2);
    }
    // Kick on 1 and 3, hats on the off-beats, a soft clap on 2 and 4 in the second half.
    if (s === 0 || s === 8) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      this.env(g, t, 0.32, 0.004, 0.3);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
    }
    if (s % 4 === 2) this.hit(t, 0.03, 7500, 'highpass', 0.05);
    if ((s === 4 || s === 12) && step >= 64) this.hit(t, 0.05, 1600, 'bandpass', 0.14);
    // Arpeggio an octave up, into the delay, in the second half of each bar.
    if (s >= 8 && s % 2 === 0) {
      const m = bar.chord[ARP[(s / 2) % ARP.length]!]! + 12;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = hz(m);
      this.env(g, t, 0.035, 0.005, STEP * 1.4);
      o.connect(g); g.connect(out); g.connect(this.delay!);
      o.start(t); o.stop(t + STEP * 2);
    }
  }

  private hit(t: number, gain: number, freq: number, type: BiquadFilterType, dur: number) {
    const ac = this.ac!;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    this.env(g, t, gain, 0.002, dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
}

export const music = new Music();
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => music.refresh());
