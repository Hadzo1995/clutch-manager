/** Fictional coaches. Each has clear strengths and weaknesses (no real people). */
import { Rng, clamp } from '../rng';
import type { Coach, CoachAttribute } from '../types';
import { COACH_ATTRIBUTES, MAPS } from '../types';

const FIRST = ['Marek', 'Jonas', 'Ilya', 'Tomas', 'Luca', 'Emil', 'Andrei', 'Kasper', 'Mateo', 'Oskar', 'Viktor', 'Dario', 'Ruben', 'Nikolai', 'Samir', 'Theo', 'Pavel', 'Mikkel', 'Anton', 'Felipe', 'Erik', 'Hakan', 'Bruno', 'Lars'];
const NICK = ['Chalk', 'Blueprint', 'Compass', 'Radar', 'Metronome', 'Anchor', 'Ledger', 'Whistle', 'Lantern', 'Gambit', 'Sextant', 'Prism', 'Keel', 'Tempo', 'Atlas', 'Bastion', 'Cipher', 'Dial', 'Ember', 'Forge', 'Harbor', 'Index', 'Juniper', 'Kestrel'];
const COUNTRIES = ['DK', 'SE', 'FR', 'BR', 'RU', 'UA', 'PL', 'FI', 'BA', 'DE', 'US', 'KZ', 'RS', 'PT', 'NO', 'CZ'];

const ARCHETYPES: { name: string; strong: CoachAttribute[]; weak: CoachAttribute[]; blurb: string }[] = [
  { name: 'Tactician', strong: ['tactics', 'mapPrep'], weak: ['motivation'], blurb: 'Lives in the demo room. Brilliant game plans, cold in the locker room.' },
  { name: 'Developer', strong: ['development', 'communication'], weak: ['adaptability'], blurb: 'Turns raw talent into finished players. Slow to change a plan mid-match.' },
  { name: 'Motivator', strong: ['motivation', 'communication'], weak: ['mapPrep'], blurb: 'Keeps morale sky high. Map preparation is not their favourite part of the job.' },
  { name: 'Analyst', strong: ['mapPrep', 'adaptability'], weak: ['development'], blurb: 'Reads opponents like a book. Less patient with young players.' },
  { name: 'Mid-game caller', strong: ['adaptability', 'tactics'], weak: ['development'], blurb: 'Excellent timeouts and adjustments. Training sessions can feel unstructured.' },
  { name: 'All-rounder', strong: ['communication'], weak: [], blurb: 'No glaring weakness, no standout strength.' },
];

export function generateCoaches(seed = 777, count = 24): Coach[] {
  const rng = new Rng(seed);
  const coaches: Coach[] = [];
  for (let i = 0; i < count; i++) {
    const arch = ARCHETYPES[i % ARCHETYPES.length]!;
    const tier = i < 4 ? 3 : i < 12 ? 2 : 1; // 3 = top tier
    const baseLevel = tier === 3 ? 74 : tier === 2 ? 64 : 54;
    const attrs = {} as Record<CoachAttribute, number>;
    for (const a of COACH_ATTRIBUTES) {
      let v = baseLevel + rng.int(-6, 6);
      if (arch.strong.includes(a)) v += rng.int(10, 18);
      if (arch.weak.includes(a)) v -= rng.int(12, 20);
      attrs[a] = clamp(v, 25, 97);
    }
    const avg = COACH_ATTRIBUTES.reduce((s, a) => s + attrs[a], 0) / COACH_ATTRIBUTES.length;
    coaches.push({
      id: `coach-${String(i + 1).padStart(2, '0')}`,
      name: `${FIRST[i % FIRST.length]} "${NICK[i % NICK.length]}"`,
      country: rng.pick(COUNTRIES),
      attrs,
      specialtyMap: rng.pick(MAPS),
      hireCost: Math.round((avg - 45) ** 2 * 1.6 / 50) * 50,
      blurb: `${arch.name}. ${arch.blurb}`,
    });
  }
  return coaches;
}

export function coachOverall(c: Coach): number {
  return Math.round(COACH_ATTRIBUTES.reduce((s, a) => s + c.attrs[a], 0) / COACH_ATTRIBUTES.length);
}
