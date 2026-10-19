/**
 * An "active manager" bot plays eight seasons: signs sponsors, rests tired
 * starters, renews the five best players, buys upgrades it can afford and
 * accepts generous bids for bench players. Checks the career stays valid.
 */
import {
  acceptBid, autoLineup, completeMatchday, currentSponsorOffers, demandOf, fixtureSnapshots, humanFixture, lineupValidation, makeOffer,
  playerStatus, profileOf, renewContract, runRecoveryWeek, runTrainingWeek, seedForFixture, signSponsor, starterFatigue, upgradeFacility,
} from '../src/engine/career';
import type { Career, World } from '../src/engine/career';
import { FACILITIES, MAX_SQUAD, marketValue, wageForLength } from '../src/engine/economy';
import { simulateSeries } from '../src/engine/match';
import { cardOvr } from '../src/engine/ratings';
import { planCost } from '../src/engine/training';
import { autoVeto } from '../src/engine/veto';
import { newCareer, world } from './helpers';

function manageWeek(w: World, c: Career): Career {
  if (!c.sponsor) c = signSponsor(c, currentSponsorOffers(c)[0]!.id);
  // Renew starters whose deals are ending.
  for (const s of c.lineup) {
    const card = c.cards.find((x) => x.cardId === s.cardId)!;
    if (card.contract && card.contract.weeksLeft <= 2 && c.coins > 0) {
      try { c = renewContract(w, c, card.cardId, 18); } catch { /* can't afford: let it run */ }
    }
  }
  // Accept bids for players outside the five.
  for (const b of [...c.bids]) if (!c.lineup.some((s) => s.cardId === b.cardId)) { try { c = acceptBid(w, c, b.id); } catch { /* blocked */ } }
  // Buy one upgrade for the weakest starter if there is money for ~10 weeks of its wage.
  if (c.season.week <= 9 && c.cards.length < MAX_SQUAD && c.coins > 1500) {
    const weakest = c.lineup.map((s) => ({ s, ovr: cardOvr(profileOf(w, c.cards.find((x) => x.cardId === s.cardId)!), c.cards.find((x) => x.cardId === s.cardId)!) })).sort((a, b) => a.ovr - b.ovr)[0]!;
    const target = w.profileList
      .filter((p) => p.record.primaryRole === weakest.s.role && p.ovr >= weakest.ovr + 3 && playerStatus(c, p.record.id).owner !== 'you')
      .map((p) => ({ p, d: demandOf(w, c, p.record.id) }))
      .filter(({ d }) => d.interest !== 'none' && d.askingFee + wageForLength(d.wage, 18) * 10 < c.coins)
      .sort((a, b) => marketValue(a.p) - marketValue(b.p))[0];
    if (target) {
      const r = makeOffer(w, c, target.p.record.id, { fee: target.d.askingFee, wage: Math.round(wageForLength(target.d.wage, 18) * (target.d.interest === 'low' ? 1.35 : 1)) + 1, weeks: 18 });
      c = r.career;
      if (r.result.ok) c = { ...c, lineup: autoLineup(w, c) };
    }
  }
  for (const id of ['training', 'medical', 'analysis'] as const) {
    const lvl = c.facilities[id];
    if (lvl < 3 && c.coins > FACILITIES[id].cost[lvl]! * 2) c = upgradeFacility(c, id);
  }
  const recover = starterFatigue(c) >= 60 || planCost(c.plan) > Math.max(0, c.coins);
  c = recover ? runRecoveryWeek(w, c) : runTrainingWeek(w, c);
  const f = humanFixture(c);
  if (!f) return completeMatchday(w, c, null);
  const teams = fixtureSnapshots(w, c, f);
  return completeMatchday(w, c, simulateSeries(seedForFixture(c, f), teams, autoVeto(f.format, teams, 0), f.format));
}

describe('long career', () => {
  it('eight seasons with an active manager stay valid', () => {
    const w = world();
    for (const [seed, difficulty] of [[4, 'normal'], [8, 'normal'], [4, 'hard'], [8, 'hard']] as const) {
      let c: Career = { ...newCareer(seed), difficulty };
      for (let week = 0; week < 96; week++) {
        expect(lineupValidation(c).ok).toBe(true);
        c = manageWeek(w, c);
        expect(c.cards.length).toBeGreaterThanOrEqual(5);
        expect(c.cards.length).toBeLessThanOrEqual(MAX_SQUAD);
        const ids = [...c.season.aiTeams, ...(c.season.cupTeams ?? [])].flatMap((t) => t.playerIds).concat(c.cards.map((x) => x.playerId));
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(c.history).toHaveLength(8);
      expect(c.ledger.reduce((s, e) => s + e.amount, 0)).toBe(c.coins - 1500);
      expect(c.ledger.length).toBeLessThanOrEqual(260);
      console.log(`seed ${seed} ${difficulty}: ${c.history.map((h) => `S${h.season} d${h.division} ${h.placement}${h.movement === 'promoted' ? '↑' : h.movement === 'relegated' ? '↓' : ''}`).join(' ')} | coins ${c.coins} rep ${Math.round(c.reputation)} squad ${c.cards.length} titles ${c.totals.titles} facilities ${JSON.stringify(c.facilities)}`);
    }
  }, 120000);
});
