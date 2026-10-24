import type { Career, World } from '../engine/career';
import { canClaimDaily, lineupValidation, teamName, weeklyWages } from '../engine/career';
import { NO_FACILITIES, facilityUpkeep } from '../engine/economy';

export type AlertTone = 'urgent' | 'info' | 'good' | '';
export type AlertTarget = 'squad' | 'train' | 'scout' | 'cases' | 'club' | { cardId: string };
export interface Alert { key: string; tone: AlertTone; text: string; cta: string; target: AlertTarget }

/** What needs the manager now, built from real career state. Used by the Home to-do list and the alerts menu. */
export function buildAlerts(world: World, c: Career, day: string): Alert[] {
  const items: Alert[] = [];
  const valid = lineupValidation(c);
  if (!valid.ok) items.push({ key: 'lineup', tone: 'urgent', text: valid.errors[0]!, cta: 'Squad', target: 'squad' });
  if (c.coins < 0) items.push({ key: 'debt', tone: 'urgent', text: `In debt by ${-c.coins}. Spending is blocked.`, cta: 'Finances', target: 'club' });
  const ww = weeklyWages(world, c);
  const burn = ww.players + ww.coach + facilityUpkeep(c.facilities ?? NO_FACILITIES) - (c.sponsor?.weekly ?? 0);
  if (c.coins >= 0 && burn > 0 && c.coins < burn * 4) items.push({ key: 'runway', tone: 'urgent', text: `Wages and upkeep outrun the sponsor by ${burn} a week. Without match income the money lasts about ${Math.max(0, Math.floor(c.coins / burn))} weeks.`, cta: 'Finances', target: 'club' });
  if (!c.sponsor) items.push({ key: 'sponsor', tone: 'urgent', text: 'No sponsor this season. Three offers are waiting.', cta: 'Choose', target: 'club' });
  for (const b of c.bids ?? []) {
    const p = world.profiles.get(b.playerId);
    items.push({ key: `bid-${b.id}`, tone: 'info', text: `${teamName(c, b.teamId)} bid ${b.fee} for ${p?.record.handle ?? 'a player'}. The offer ends with this week.`, cta: 'Review', target: { cardId: b.cardId } });
  }
  for (const card of c.cards) {
    if (card.contract && card.contract.weeksLeft <= 3) {
      const p = world.profiles.get(card.playerId);
      items.push({ key: `ct-${card.cardId}`, tone: 'urgent', text: `${p?.record.handle ?? 'A player'}'s contract ends in ${card.contract.weeksLeft} week${card.contract.weeksLeft === 1 ? '' : 's'}.`, cta: 'Renew', target: { cardId: card.cardId } });
    }
  }
  const tired = c.lineup.map((s) => c.cards.find((x) => x.cardId === s.cardId)).filter((x) => x && x.fatigue >= 60);
  if (tired.length && c.phase === 'training') items.push({ key: 'tired', tone: 'info', text: `${tired.length} starter${tired.length === 1 ? ' is' : 's are'} tired (60+ fatigue). Add a rest day.`, cta: 'Train', target: 'train' });
  if (canClaimDaily(c, day)) items.push({ key: 'daily', tone: 'good', text: 'Your free daily case is ready.', cta: 'Open', target: 'cases' });
  if (c.lineup.length === 5 && c.cards.length < 7) items.push({ key: 'depth', tone: 'info', text: `Only ${c.cards.length} players. A bench player covers tired starters and expiring contracts.`, cta: 'Scout', target: 'scout' });
  return items;
}
