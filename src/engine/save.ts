/**
 * Save format: versioned JSON. `migrate` upgrades older saves step by step and
 * fills fields added later with safe defaults, so old careers keep loading.
 */
import { SAVE_VERSION } from './career';
import type { Career } from './career';

export interface SaveFile {
  format: 'csm-save';
  version: number;
  savedAt: string;
  career: Career;
}

export function serializeCareer(career: Career, now = new Date().toISOString()): string {
  const file: SaveFile = { format: 'csm-save', version: SAVE_VERSION, savedAt: now, career };
  return JSON.stringify(file);
}

export class SaveError extends Error {}

/** Optional fix-up that needs the world (player data), e.g. giving old cards a contract. */
export function deserializeCareer(json: string, fixCard?: (card: Career['cards'][number]) => void): Career {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new SaveError('The save file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || (data as SaveFile).format !== 'csm-save') throw new SaveError('This is not a Clutch Manager save file.');
  const file = data as SaveFile;
  if (typeof file.version !== 'number' || file.version > SAVE_VERSION) throw new SaveError(`Save version ${file.version} is newer than this game (${SAVE_VERSION}).`);
  const career = migrate(file).career;
  if (fixCard) for (const card of career.cards) if (!card.contract) fixCard(card);
  return career;
}

function migrate(file: SaveFile): SaveFile {
  const c = file.career as Partial<Career> & Career;
  // v1 is the first version. Defaults below protect against hand-edited or partial saves.
  c.news ??= [];
  c.achievements ??= [];
  c.matches ??= [];
  c.history ??= [];
  c.lastLineup ??= c.lineup?.map((s) => s.cardId) ?? [];
  c.prepBonus ??= 0;
  // Map pool change (Train -> Cache): move practice and plans over so old careers keep working.
  const renameMap = (rec: Record<string, number> | undefined) => {
    if (rec && 'Train' in rec) { rec.Cache ??= rec.Train!; delete rec.Train; }
  };
  renameMap(c.mapPractice as unknown as Record<string, number>);
  for (const t of c.season?.aiTeams ?? []) renameMap(t.mapPractice as unknown as Record<string, number>);
  if ((c.plan?.focusMap as string) === 'Train') c.plan.focusMap = 'Cache';
  c.reputation ??= 10;
  if (c.season && c.season.sponsorRep === undefined) c.season.sponsorRep = c.reputation;
  c.sponsor ??= null;
  c.ledger ??= [];
  c.negotiations ??= {};
  c.shortlist ??= [];
  c.bids ??= [];
  c.difficulty ??= 'normal';
  c.facilities ??= { training: 0, analysis: 0, medical: 0 };
  if (c.tactics) c.tactics.economy ??= 'standard';
  c.totals ??= { matches: 0, wins: 0, losses: 0, casesOpened: 0, titles: 0, legendsPulled: 0 };
  for (const card of c.cards ?? []) {
    card.growth ??= {};
    card.stars ??= 0;
    card.sharpness ??= 60;
    card.fatigue ??= 0;
    card.morale ??= 60;
    card.form ??= 0;
    card.matchesPlayed ??= 0;
  }
  if (!Array.isArray(c.cards) || !c.season || !Array.isArray(c.lineup)) throw new SaveError('The save file is missing core data (cards, lineup or season).');
  return { ...file, version: SAVE_VERSION, career: c };
}
