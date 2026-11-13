/** The club's balance never goes below zero. */
import {
  completeMatchday, currentSponsorOffers, ensureContracts, fixtureSnapshots, humanFixture, releaseCard, runRecoveryWeek, seedForFixture, signSponsor,
} from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { simulateSeries } from '../src/engine/match';
import { autoVeto } from '../src/engine/veto';
import { newCareer, world } from './helpers';

function playWeek(w: World, c: Career): Career {
  c = runRecoveryWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, autoVeto(f.format, teams, 0), f.format));
}

describe('balance floor', () => {
  it('the board covers bills the club cannot pay, and loses confidence', () => {
    const w = world();
    let c = newCareer(3);
    c = { ...c, coins: 0, cards: c.cards.map((x) => (x.contract ? { ...x, contract: { ...x.contract, wage: x.contract.wage + 2000 } } : x)) };
    const before = c.board!.confidence;
    c = playWeek(w, c);
    expect(c.coins).toBe(0);
    expect(c.ledger.some((e) => e.kind === 'board' && e.amount > 0)).toBe(true);
    expect(c.board!.confidence).toBeLessThan(before);
  });

  it('never goes negative over a season of high wages', () => {
    const w = world();
    let c = newCareer(5);
    c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
    c = { ...c, cards: c.cards.map((x) => (x.contract ? { ...x, contract: { ...x.contract, wage: x.contract.wage * 4 } } : x)) };
    for (let week = 0; week < 12; week++) {
      c = playWeek(w, c);
      expect(c.coins).toBeGreaterThanOrEqual(0);
    }
  });

  it('blocks a release whose severance the club cannot pay', () => {
    const w = world();
    const c = { ...newCareer(6), coins: 0 };
    const bench = c.cards.find((x) => !c.lineup.some((s) => s.cardId === x.cardId) && x.contract && x.contract.wage > 0);
    if (!bench) return;
    expect(() => releaseCard(w, c, bench.cardId)).toThrow(/severance/);
  });

  it('clears debt from old saves once, through the ledger', () => {
    const w = world();
    const c = { ...newCareer(2), coins: -800 };
    const n = ensureContracts(w, c);
    expect(n.coins).toBe(0);
    expect(n.ledger[0]).toMatchObject({ kind: 'board', amount: 800 });
  });
});
