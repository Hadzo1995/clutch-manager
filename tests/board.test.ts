import { describe, expect, it } from 'vitest';
import { BOARD_BONUS, BOARD_GOAL_PLACE, completeMatchday, ensureBoard, fixtureSnapshots, humanFixture, runTrainingWeek, seedForFixture } from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { newCareer, world } from './helpers';

function playWeek(w: World, c: Career): Career {
  c = runTrainingWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, autoVeto(f.format, teams, 0), f.format));
}

describe('board', () => {
  it('sets a target at the start, judges it at the end of the season and sets a new one', () => {
    const w = world();
    let c = { ...newCareer(21), coins: 50000 };
    expect(c.board?.season).toBe(1);
    expect(ensureBoard(w, c)).toBe(c);
    // An old save without a board gets one.
    const old = ensureBoard(w, { ...c, board: undefined });
    expect(old.board?.goal).toBeDefined();
    while (c.season.number === 1) c = playWeek(w, c);
    const h = c.history[0]!;
    expect(h.board).toBeDefined();
    expect(h.board!.met).toBe(h.placement <= BOARD_GOAL_PLACE[h.board!.goal]);
    const bonus = c.ledger.find((e) => e.season === 1 && e.label.startsWith('Board bonus'));
    if (h.board!.met) expect(bonus?.amount).toBe(BOARD_BONUS[h.division]);
    else expect(bonus).toBeUndefined();
    expect(c.board?.season).toBe(2);
    expect(c.board!.confidence).toBeGreaterThanOrEqual(0);
    expect(c.board!.confidence).toBeLessThanOrEqual(100);
  });
});
