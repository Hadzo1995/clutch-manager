/**
 * Procedural team crests: a shield silhouette, a two-tone field split, an emblem and the tag,
 * all chosen from a hash of the team name so every club keeps the same badge across screens.
 * Pure SVG, no assets. The player's club can pass a fixed hue (amber, the brand colour).
 */
import { memo, useSyncExternalStore } from 'react';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const SHIELDS = [
  'M50 4 L92 16 V52 C92 76 72 90 50 98 C28 90 8 76 8 52 V16 Z',
  'M12 6 H88 V58 C88 78 70 92 50 98 C30 92 12 78 12 58 Z',
  'M50 3 L94 22 L84 74 L50 98 L16 74 L6 22 Z',
  'M50 4 L86 10 L94 40 L78 84 L50 98 L22 84 L6 40 L14 10 Z',
  'M16 4 H84 L94 14 V60 L50 98 L6 60 V14 Z',
];
const SPLITS = [
  'M0 0 H50 V100 H0 Z',
  'M0 0 H100 L0 100 Z',
  'M0 0 H100 V44 H0 Z',
  'M50 0 L100 0 L100 100 L50 100 L50 60 L30 50 L50 40 Z',
  'M0 62 H100 V100 H0 Z',
];
// Emblems drawn in a 100-unit box, placed in the upper part of the shield.
const EMBLEMS = [
  'M50 22 L56 36 L71 37 L59 46 L63 61 L50 52 L37 61 L41 46 L29 37 L44 36 Z', // star
  'M32 30 L50 46 L68 30 L68 40 L50 56 L32 40 Z', // chevron
  'M56 18 L36 46 H50 L44 66 L66 36 H52 Z', // bolt
  'M30 52 L34 28 L42 40 L50 24 L58 40 L66 28 L70 52 Z', // crown
  'M50 20 L66 40 L50 60 L34 40 Z', // diamond
  'M50 20 C62 30 66 44 50 62 C34 44 38 30 50 20 Z', // flame
  'M30 28 H70 L50 60 Z', // arrowhead
  'M50 22 A18 18 0 1 0 50.1 22 Z M50 30 A10 10 0 1 1 49.9 30 Z', // ring
];

export interface CrestLook { shield: number; split: number; emblem: number; hue: number; sat: number }
export type CrestDesign = Pick<CrestLook, 'shield' | 'split' | 'emblem' | 'hue'>;
export const CREST_PARTS = { shields: SHIELDS.length, splits: SPLITS.length, emblems: EMBLEMS.length };
/** Hues offered in the crest editor; the first is the brand amber. */
export const CREST_HUES = [34, 8, 350, 300, 262, 220, 196, 168, 130, 90, 50, 0];

// The player's own design lives in a tiny store so every crest marked `mine` updates at once.
let myDesign: CrestDesign | undefined;
const listeners = new Set<() => void>();
export function setMyCrest(d: CrestDesign | undefined) {
  if (d === myDesign || (d && myDesign && d.shield === myDesign.shield && d.split === myDesign.split && d.emblem === myDesign.emblem && d.hue === myDesign.hue)) return;
  myDesign = d;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const getMine = () => myDesign;

export function crestLook(name: string, hue?: number): CrestLook {
  const h = hash(name || '?');
  return {
    shield: h % SHIELDS.length,
    split: (h >>> 4) % SPLITS.length,
    emblem: (h >>> 8) % EMBLEMS.length,
    hue: hue ?? ((h >>> 12) % 360),
    sat: 46 + ((h >>> 20) % 22),
  };
}

/**
 * `mine` marks the player's own club: amber by default, or the design from the crest editor.
 * `design` forces a specific design (the editor's preview).
 */
export const Crest = memo(function Crest({ name, tag, size = 40, hue, mine = false, design, className = '' }: { name: string; tag: string; size?: number; hue?: number; mine?: boolean; design?: CrestDesign; className?: string }) {
  const stored = useSyncExternalStore(subscribe, getMine, getMine);
  const custom = design ?? (mine ? stored : undefined);
  const base0 = crestLook(name, hue ?? (mine ? MY_HUE : undefined));
  const k: CrestLook = custom ? { ...base0, ...custom, sat: 58 } : base0;
  const id = `cr${hash(name + tag + JSON.stringify(k)).toString(36)}`;
  const base = `hsl(${k.hue} ${k.sat}% 30%)`;
  const light = `hsl(${k.hue} ${k.sat + 10}% 52%)`;
  const deep = `hsl(${k.hue} ${k.sat - 10}% 14%)`;
  const metal = `hsl(${k.hue} 30% 78%)`;
  const label = tag.slice(0, 4).toUpperCase();
  const fs = label.length >= 4 ? 19 : label.length === 3 ? 23 : 28;
  return (
    <svg className={`crest ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}><path d={SHIELDS[k.shield]} /></clipPath>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={base} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="100" height="100" fill={`url(#${id}g)`} />
        <path d={SPLITS[k.split]} fill={deep} opacity="0.55" />
        <path d={EMBLEMS[k.emblem]} transform="translate(25 2) scale(0.5)" fill={metal} opacity="0.9" fillRule="evenodd" />
        <rect y="58" width="100" height="26" fill="rgba(0,0,0,0.38)" />
        <rect width="100" height="100" fill={`url(#${id}s)`} />
      </g>
      <path d={SHIELDS[k.shield]} fill="none" stroke={metal} strokeOpacity="0.85" strokeWidth="3.5" />
      <path d={SHIELDS[k.shield]} fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1" transform="translate(50 50) scale(0.9) translate(-50 -50)" />
      <text x="50" y="77" textAnchor="middle" fontFamily="'Chakra Petch', 'Segoe UI', sans-serif" fontWeight="700" fontSize={fs} letterSpacing="0.5" fill="#fff">{label}</text>
    </svg>
  );
});

/** The player's own club is always amber (brand / T colour), opponents keep their own hue. */
export const MY_HUE = 34;
