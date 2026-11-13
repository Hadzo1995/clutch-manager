/**
 * Menu sound effects: recorded clicks, a tab switch, a toggle and coin sounds, from Kenney's
 * "UI sounds" and "Casino sounds" packs (CC0, https://kenney.nl). Each file is a few KB of mono MP3,
 * normalized to the same peak. Decoded once into Web Audio buffers on the first tap or key press
 * (browsers only allow audio after a gesture), then played with a little pitch variation so repeats
 * don't sound mechanical. On by default; the Settings switch persists.
 */
import clickUrl from './assets/sfx/click.mp3?url';
import tabUrl from './assets/sfx/tab.mp3?url';
import toggleUrl from './assets/sfx/toggle.mp3?url';
import coinsUrl from './assets/sfx/coins.mp3?url';
import spendUrl from './assets/sfx/spend.mp3?url';

export type Sfx = 'click' | 'tab' | 'toggle' | 'coins' | 'spend';
const URLS: Record<Sfx, string> = { click: clickUrl, tab: tabUrl, toggle: toggleUrl, coins: coinsUrl, spend: spendUrl };
/** Per-sound level: clicks sit well under the music, rewards a little above it. */
const LEVEL: Record<Sfx, number> = { click: 0.22, tab: 0.28, toggle: 0.22, coins: 0.4, spend: 0.3 };

const KEY = 'clutch-manager.ui-sound';
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
let ac: AudioContext | null = null;
let out: GainNode | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
let loading: Promise<void> | null = null;

export const uiSoundOn = () => enabled;
export function setUiSound(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
  if (on) void unlockSfx();
}

/** Create the audio context and decode the sounds. Safe to call often; does the work once. */
export function unlockSfx(): Promise<void> {
  if (!enabled || typeof window === 'undefined') return Promise.resolve();
  if (!ac) {
    try { ac = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { ac = null; return Promise.resolve(); }
    out = ac.createGain();
    out.connect(ac.destination);
  }
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  loading ??= Promise.all((Object.keys(URLS) as Sfx[]).map(async (k) => {
    try {
      const data = await (await fetch(URLS[k])).arrayBuffer();
      buffers.set(k, await ac!.decodeAudioData(data));
    } catch { /* this one stays silent */ }
  })).then(() => {});
  return loading;
}

export function sfx(name: Sfx): void {
  if (!enabled || !ac || !out) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.96 + Math.random() * 0.08;
  const g = ac.createGain();
  g.gain.value = LEVEL[name];
  src.connect(g).connect(out);
  src.start();
}

/**
 * One listener for the whole app: every button press clicks, except where a screen has its own
 * sounds (the case opening) or the press is a tab switch (that has its own sound).
 */
export function installUiSounds(): () => void {
  const onDown = (e: Event) => {
    void unlockSfx();
    const el = (e.target as Element | null)?.closest?.('button, [role="button"], a[href]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.closest('.co-stage, .side-nav, .tabbar')) return;
    sfx(el.hasAttribute('aria-pressed') ? 'toggle' : 'click');
  };
  const onKey = () => { void unlockSfx(); };
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  document.addEventListener('keydown', onKey, { capture: true, passive: true });
  return () => { document.removeEventListener('pointerdown', onDown, { capture: true }); document.removeEventListener('keydown', onKey, { capture: true }); };
}
