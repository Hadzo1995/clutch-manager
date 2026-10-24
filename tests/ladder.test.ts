import { describe, expect, it } from 'vitest';
import { botTeam, eloSwing, ladderTeam, playLadder } from '../src/engine/ladder';
import { validatePvpTeam, pvpTeam } from '../src/engine/pvp';
import { newCareer, world } from './helpers';

describe('beta ladder', () => {
  const w = world();
  const c = newCareer(7);
  const me = ladderTeam(w, c);
  const bot = botTeam(w, c, 3, 'Iron Wolves', 'IRO');

  it('publishes a legal PvP team without opponent preparation', () => {
    expect(me.prepBonus).toBe(0);
    expect(validatePvpTeam(pvpTeam(me, 0)).errors).toEqual([]);
  });

  it('builds bots from league rivals under the bot name', () => {
    expect(bot.name).toBe('Iron Wolves');
    expect(bot.tag).toBe('IRO');
    expect(bot.players).toHaveLength(5);
  });

  it('gives the same result for the same seed and teams', () => {
    const a = playLadder(12345, me, bot);
    const b = playLadder(12345, JSON.parse(JSON.stringify(me)), JSON.parse(JSON.stringify(bot)));
    expect(a.hash).toBe(b.hash);
    expect(a.won).toBe(a.series.winner === 0);
    expect(a.series.maps).toHaveLength(1);
  });

  it('moves 16 points between equal ratings and fewer for an expected win', () => {
    expect(eloSwing(1000, 1000)).toEqual({ win: 16, loss: -16 });
    const fav = eloSwing(1200, 1000);
    expect(fav.win).toBeLessThan(16);
    expect(fav.loss).toBeLessThan(-16);
  });
});
