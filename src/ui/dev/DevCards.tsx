/**
 * Development only (#dev-cards): every rarity of the collectible card side by side, so the
 * frames, foils and type can be checked without opening cases.
 */
import { createWorld } from '../../engine/career';
import { generateSyntheticDataset } from '../../engine/data/generateDataset';
import { realDataset } from '../../engine/data/realPlayers';
import type { OwnedCard, Rarity } from '../../engine/types';
import { CollectibleCard } from '../cards/CollectibleCard';

const RARITIES: Rarity[] = ['legend', 'elite', 'gold', 'silver', 'bronze'];

export default function DevCards() {
  const world = createWorld(realDataset() ?? generateSyntheticDataset());
  const pick = (r: Rarity, n = 0) => world.profileList.filter((p) => p.rarity === r)[n]!;
  const owned = (id: string, stars: number): OwnedCard => ({ cardId: 'dev', playerId: id, acquiredWeek: 0, growth: {}, stars, sharpness: 80, fatigue: 0, morale: 70, form: 0, matchesPlayed: 0 });
  return (
    <div style={{ padding: 32, display: 'grid', gap: 40, background: '#070a0e', minHeight: '100vh' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
        {RARITIES.map((r) => <CollectibleCard key={r} profile={pick(r)} size="lg" />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        {RARITIES.map((r) => { const p = pick(r, 3); return <CollectibleCard key={r} profile={p} card={owned(p.record.id, 3)} size="md" />; })}
      </div>
    </div>
  );
}
