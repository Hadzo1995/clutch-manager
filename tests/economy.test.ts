import { describe, expect, it } from 'vitest';
import {
  acceptBid, declineBid, compactLedger, runRecoveryWeek, starterFatigue, upgradeFacility,
  completeMatchday, currentSponsorOffers, demandOf, fixtureSnapshots, humanFixture, makeOffer, offersLeft, playerStatus, releaseCard,
  runTrainingWeek, salePrice, seedForFixture, sellCard, signSponsor, weeklyWages, bidCeiling, counterBid, standingCounter,
} from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { MAX_SQUAD, judgeOffer, marketValue } from '../src/engine/economy';
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

describe('economy', () => {
  it('sponsor offers stay fixed during a season even when reputation changes', () => {
    const c = newCareer(5);
    const before = currentSponsorOffers(c);
    expect(currentSponsorOffers({ ...c, reputation: c.reputation + 40 })).toEqual(before);
  });

  it('a recovery week is free, lowers fatigue and keeps the saved plan', () => {
    const w = world();
    const c = newCareer(6);
    const tired = { ...c, coins: 0, cards: c.cards.map((x) => ({ ...x, fatigue: 90 })) };
    const n = runRecoveryWeek(w, tired);
    expect(n.coins).toBe(0);
    expect(n.plan).toEqual(c.plan);
    expect(starterFatigue(n)).toBeLessThan(60);
    expect(n.phase).toBe('matchday');
  });

  it('AI clubs sign players and bid for yours; bids can be accepted or turned down', () => {
    const w = world();
    let c = newCareer(21);
    let sawBid = false;
    let aiSigning = false;
    for (let week = 0; week < 9; week++) {
      if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
      c = playWeek(w, c);
      if (c.bids.length) sawBid = true;
      if (c.news.some((n) => / sign .* and let .* go\./.test(n))) aiSigning = true;
      // No player is ever on two teams.
      const ids = [...c.season.aiTeams.flatMap((t) => t.playerIds), ...c.cards.map((x) => x.playerId)];
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(aiSigning).toBe(true);
    expect(sawBid).toBe(true);

    // Build a bid by hand to check both answers.
    const card = c.cards.find((x) => !c.lineup.some((s) => s.cardId === x.cardId)) ?? c.cards[0]!;
    const withBid = { ...c, phase: 'training' as const, bids: [{ id: 'test', cardId: card.cardId, playerId: card.playerId, teamId: c.season.aiTeams[0]!.id, fee: 900, season: c.season.number, expiresWeek: c.season.week }] };
    const sold = acceptBid(w, withBid, 'test');
    expect(sold.cards.some((x) => x.cardId === card.cardId)).toBe(false);
    expect(sold.coins).toBe(withBid.coins + 900);
    expect(sold.season.aiTeams[0]!.playerIds).toContain(card.playerId);
    expect(sold.ledger.reduce((s, e) => s + e.amount, 0)).toBe(sold.coins - 1500);
    const kept = declineBid(w, withBid, 'test');
    expect(kept.cards.some((x) => x.cardId === card.cardId)).toBe(true);
    expect(kept.bids).toHaveLength(0);
  });

  it('facilities cost money, charge upkeep and speed up recovery', () => {
    const w = world();
    let c = { ...newCareer(12), coins: 5000 };
    expect(() => upgradeFacility({ ...c, coins: 100 }, 'medical')).toThrow();
    c = upgradeFacility(c, 'medical');
    expect(c.coins).toBe(3000);
    expect(c.facilities.medical).toBe(1);
    const tired = { ...c, cards: c.cards.map((x) => ({ ...x, fatigue: 100 })) };
    const plain = runRecoveryWeek(w, { ...tired, facilities: { training: 0, analysis: 0, medical: 0 } });
    const better = runRecoveryWeek(w, tired);
    expect(starterFatigue(better)).toBeLessThan(starterFatigue(plain));
  });

  it('a club in debt can still run a free week', () => {
    const w = world();
    const c = { ...newCareer(13), coins: -300 };
    expect(runRecoveryWeek(w, c).phase).toBe('matchday');
  });

  it('ledger compaction keeps the sum', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ season: 1 + Math.floor(i / 100), week: 1 + (i % 9), kind: (i % 2 ? 'wages' : 'match') as 'wages' | 'match', amount: i % 2 ? -10 : 25, label: 'x' }));
    const out = compactLedger(entries, 4);
    expect(out.length).toBeLessThan(entries.length);
    expect(out.reduce((s, e) => s + e.amount, 0)).toBe(entries.reduce((s, e) => s + e.amount, 0));
  });

  it('ledger always explains the balance, wages are paid weekly', () => {
    const w = world();
    let c = newCareer(5);
    const start = c.coins;
    c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
    const wages = weeklyWages(w, c);
    expect(wages.players).toBeGreaterThan(0);
    c = playWeek(w, c);
    const paid = c.ledger.filter((e) => e.kind === 'wages').reduce((s, e) => s + e.amount, 0);
    expect(paid).toBe(-(wages.players + wages.coach));
    expect(c.ledger.reduce((s, e) => s + e.amount, 0)).toBe(c.coins - start);
  });

  it('stays within sensible bounds over three seasons of auto play', () => {
    const w = world();
    let c = newCareer(9);
    const balances: number[] = [];
    for (let week = 0; week < 36; week++) {
      if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[1]!.id);
      c = playWeek(w, c);
      balances.push(c.coins);
      expect(c.cards.length).toBeGreaterThanOrEqual(5);
      expect(c.lineup.length).toBe(5);
    }
    // Contracts of the starter squad (18 weeks) must have been handled without breaking the lineup.
    expect(Math.max(...balances)).toBeLessThan(60000);
    expect(c.ledger.reduce((s, e) => s + e.amount, 0)).toBe(c.coins - 1500);
  });

  it('transfers respect budget, squad size and offer limits, and take the player from the AI team', () => {
    const w = world();
    let c = newCareer(3);
    c = { ...c, coins: 100000 };
    const target = c.season.aiTeams[0]!.playerIds[0]!;
    expect(playerStatus(c, target).owner).toBe('ai');
    const d = demandOf(w, c, target);
    const low = makeOffer(w, c, target, { fee: Math.floor(d.askingFee / 2), wage: d.wage, weeks: 18 });
    expect(low.result.ok).toBe(false);
    expect(offersLeft(low.career, target)).toBe(2);
    if (d.interest === 'none') return;
    const wage = d.interest === 'low' ? Math.ceil(d.wage * 1.4) : d.wage;
    const good = makeOffer(w, low.career, target, { fee: d.askingFee, wage, weeks: 18 });
    expect(good.result.ok).toBe(true);
    expect(playerStatus(good.career, target).owner).toBe('you');
    expect(good.career.season.aiTeams.some((t) => t.playerIds.includes(target))).toBe(false);
    expect(good.career.season.aiTeams.every((t) => t.playerIds.length === 5)).toBe(true);
    expect(good.career.coins).toBe(100000 - d.askingFee);
    // Broke club cannot pay a fee.
    const poor = makeOffer(w, { ...c, coins: 10 }, target, { fee: d.askingFee, wage, weeks: 18 });
    expect(poor.result.ok).toBe(false);
  });

  it('blocks a full squad, protects the minimum of five and prices sales below market value', () => {
    const w = world();
    const c = newCareer(4);
    const full = { ...c, cards: [...c.cards, ...Array.from({ length: MAX_SQUAD - c.cards.length }, (_, i) => ({ ...c.cards[0]!, cardId: `x${i}`, playerId: w.profileList[150 + i]!.record.id }))] };
    const free = w.profileList.find((p) => playerStatus(full, p.record.id).owner === 'free')!;
    expect(makeOffer(w, full, free.record.id, { fee: 99999, wage: 9999, weeks: 18 }).result.ok).toBe(false);
    const bench = c.cards.find((x) => !c.lineup.some((s) => s.cardId === x.cardId))!;
    const sold = sellCard(w, c, bench.cardId);
    expect(sold.coins).toBe(c.coins + salePrice(w, bench));
    expect(salePrice(w, bench)).toBeLessThan(marketValue(w.profiles.get(bench.playerId)!));
    expect(() => releaseCard(w, sold, sold.cards[0]!.cardId)).toThrow(/at least five/);
  });

  it('offer judging is consistent', () => {
    const d = { askingFee: 1000, wage: 100, interest: 'high' as const, reason: '' };
    expect(judgeOffer(d, { fee: 1000, wage: 100, weeks: 18 }).ok).toBe(true);
    expect(judgeOffer(d, { fee: 1000, wage: 100, weeks: 9 }).ok).toBe(false); // short deals cost more per week
    expect(judgeOffer(d, { fee: 1000, wage: 95, weeks: 27 }).ok).toBe(true);
    expect(judgeOffer(d, { fee: 999, wage: 60, weeks: 18 }).ok).toBe(false);
    expect(judgeOffer(d, { fee: 1000, wage: 60, weeks: 12 }).ok).toBe(false);
  });
});

describe('economy report', () => {
  it('prints balance over three seasons', () => {
    const w = world();
    for (const seed of [1, 2, 3]) {
      let c = newCareer(seed);
      const line: string[] = [];
      for (let week = 0; week < 36; week++) {
        if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
        c = playWeek(w, c);
        if (week % 3 === 2) line.push(`${c.coins}`);
      }
      console.log(`seed ${seed}: div ${c.season.division} rep ${Math.round(c.reputation)} coins ${line.join(' ')}`);
    }
  });
});

describe('negotiation', () => {
  it('keeps a counter-offer open for the week, even after the offers run out', () => {
    const w = world();
    const c = { ...newCareer(3), coins: 100000 };
    const target = c.season.aiTeams.flatMap((t) => t.playerIds).find((id) => demandOf(w, c, id).interest !== 'none')!;
    const d = demandOf(w, c, target);
    let n = c;
    for (let i = 0; i < 3; i++) n = makeOffer(w, n, target, { fee: 0, wage: 15, weeks: 18 }).career;
    expect(offersLeft(n, target)).toBe(0);
    const counter = standingCounter(n, target)!;
    expect(counter.fee).toBeGreaterThanOrEqual(d.askingFee);
    expect(makeOffer(w, n, target, { fee: 0, wage: 15, weeks: 18 }).result.ok).toBe(false);
    const signed = makeOffer(w, n, target, counter);
    expect(signed.result.ok).toBe(true);
    expect(playerStatus(signed.career, target).owner).toBe('you');
  });

  it('a bidding club pays up to its ceiling, gives one final offer, or walks away', () => {
    const w = world();
    const c = newCareer(5);
    const card = c.cards.find((x) => !c.lineup.some((s) => s.cardId === x.cardId))!;
    const bid = { id: 'neg', cardId: card.cardId, playerId: card.playerId, teamId: c.season.aiTeams[0]!.id, fee: 1000, season: c.season.number, expiresWeek: c.season.week + 1 };
    const base = { ...c, bids: [bid] };
    const top = bidCeiling(bid);
    expect(top).toBeGreaterThanOrEqual(1000);
    expect(top).toBeLessThanOrEqual(1250);

    const yes = counterBid(w, base, 'neg', top);
    expect(yes.result).toEqual({ outcome: 'accepted', fee: top });
    expect(yes.career.coins).toBe(c.coins + top);
    expect(yes.career.cards.some((x) => x.cardId === card.cardId)).toBe(false);

    const fin = counterBid(w, base, 'neg', Math.floor(top * 1.15) + 1);
    if (top * 1.15 + 1 > top) {
      expect(fin.result.outcome).toBe('final');
      expect(fin.career.bids[0]!.fee).toBe(top);
      expect(() => counterBid(w, fin.career, 'neg', top + 500)).toThrow(/final/);
    }

    const gone = counterBid(w, base, 'neg', top * 2);
    expect(gone.result.outcome).toBe('walked');
    expect(gone.career.bids).toHaveLength(0);
    expect(gone.career.cards.some((x) => x.cardId === card.cardId)).toBe(true);
  });
});
