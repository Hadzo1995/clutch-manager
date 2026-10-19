/**
 * Tactical layer.
 *
 * Most of what a tactic does happens in the round simulation (sim/round.ts):
 * a rush runs (and is heard), a default takes space, smokes common angles and
 * regroups before the hit, an execute stages and times its grenades, a stack
 * puts three players on one site, a retake setup holds deep and comes back
 * together, aggressive CTs push for early picks.
 *
 * COUNTER_TABLE adds a small "read" edge per matchup on top of that. It does
 * two jobs, both tuned with batch runs (scratch/counters.ts, see BALANCING.md):
 *  - offsets per approach, so the faster approaches do not dominate the slower
 *    ones (the simulation alone gave rushes about 15 points more than defaults);
 *  - the intended counters, a few points either way.
 * Fictional tuning, not measured from real matches.
 */
import type { CTSetup, MapName, TApproach } from './types';

export const COUNTER_TABLE: Record<TApproach, Record<CTSetup, number>> = {
  default: { standard: 0, stack: 0.06, retake: 0.06, aggro: -0.28 },
  execute: { standard: -0.47, stack: -0.37, retake: -0.65, aggro: -0.39 },
  rush: { standard: -0.64, stack: -0.35, retake: -0.85, aggro: -0.5 },
};

/** Stack guessed right: big CT edge. Wrong: T walks into an under-manned site. */
export const STACK_SWING = { correct: -0.5, wrong: 0.42 };

/**
 * Map calibration: a T-side edge per map (positive helps T). The layouts are
 * simplified block-outs, so some favour one side more than the real maps do.
 * These values were tuned with batch simulations (scratch/calib.ts) to keep
 * each map's T round-win rate in a plausible 43-52% band for equal teams.
 * Fictional tuning, not measured data.
 */
export const MAP_T_BIAS: Record<MapName, number> = {
  // v0.9: the six traced maps start from 0 and are calibrated with MapSource.sideTune
  // instead (src/maps/data/*.ts). These old values were for the hand-drawn layouts.
  Mirage: 0,
  Inferno: 0,
  Nuke: -0.67,
  Ancient: 0,
  Anubis: 0,
  Dust2: 0,
  Cache: 0,
};

/**
 * Measured T-side round-win rate for each plan matchup with equal teams, from
 * scratch/counters.ts on the v0.9 simulation and maps (7 maps × 12 maps × 12 T rounds,
 * about 1,000 rounds per cell, so about ±3 points). Used for the prep screen's
 * suggestion and the tips; see BALANCING.md.
 */
export const MATCHUP_T_WIN: Record<TApproach, Record<CTSetup, number>> = {
  default: { standard: 0.562, stack: 0.512, retake: 0.492, aggro: 0.493 },
  execute: { standard: 0.495, stack: 0.47, retake: 0.457, aggro: 0.491 },
  rush: { standard: 0.525, stack: 0.458, retake: 0.459, aggro: 0.55 },
};

export function describeCounter(t: TApproach, ct: CTSetup): string {
  const v = MATCHUP_T_WIN[t][ct];
  if (ct === 'stack') return 'Stack is a guess: right site favours CT heavily, wrong site favours T.';
  if (v >= 0.53) return 'Favours the T side.';
  if (v <= 0.47) return 'Favours the CT side.';
  return 'Roughly even.';
}

export const TACTIC_TIPS: Record<TApproach | CTSetup, string> = {
  default: 'Slow map control: smokes the usual angles, regroups, then hits the lighter site. Solid into stacks and retake setups; aggressive CTs catch it spread out.',
  execute: 'Sets up quietly, then hits one site with timed smokes, flashes and a molotov. Good into aggressive CTs and a stack on the other site; a retake setup gives up the plant and wins it back.',
  rush: 'All five run straight in, loud. Runs over aggressive CTs and thin standard setups; a stack on the right site or a retake setup beats it.',
  standard: 'Two on each site, one mid. Solid against defaults and executes; a rush can run over it.',
  stack: 'Three on one site. Strong when you guess the site, a gift when you do not. Use the scouting report.',
  retake: 'Light on the sites, ready to come back together with utility. Best against rushes and executes, weaker against slow defaults.',
  aggro: 'Two players push for early picks and information, then fall back. Catches slow defaults; rushes and executes run through it.',
};
