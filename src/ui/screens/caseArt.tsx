import type { Role } from '../../engine/types';

/**
 * Weapon silhouettes drawn behind each player on the case strip, so a tile reads like a
 * CS2 drop: the AWPer's rifle, a pistol for the in-game leader, a rifle for everyone else.
 * Original flat shapes (no game assets), filled with the tile's rarity colour.
 */
const SHAPES = {
  // Bolt-action sniper: stock, scope on top, long barrel.
  sniper: 'M2 15 L9 12 L28 12.5 L32 10.5 L45 10.5 L46 6.5 L50 5.5 L72 5.5 L74 6.5 L74 10.5 L84 10.5 L84 11.2 L126 11.2 L126 13.6 L84 13.6 L82 15.5 L64 15.5 L62 17 L60 24 L55 24 L56 16.2 L46 16.2 L44 22.5 L38 23 L37 17 L30 17 L11 22.5 L2 22.5 Z',
  // Assault rifle: skeleton stock, curved magazine, front sight.
  rifle: 'M3 13 L23 11 L27 9.5 L66 9.5 L68 7.5 L72 7.5 L72 9.5 L96 9.5 L98 7 L100 7 L100 9.5 L124 9.5 L124 12 L100 12 L98 14 L80 14 L78 15.5 L64 15.5 L62 16 L66 30 L59 31.5 L54 16.5 L44 16.5 L41 24 L35 24 L36 16.5 L28 16 L6 21.5 L3 21.5 Z',
  // Heavy pistol.
  pistol: 'M40 9 L104 9 L106 10.5 L106 16 L66 16 L63 18 L58 18 L54 33 L41 33 L46 18 L42 16.5 Z',
} as const;

export type WeaponKind = keyof typeof SHAPES;
export const weaponFor = (role: Role): WeaponKind => (role === 'awp' ? 'sniper' : role === 'igl' ? 'pistol' : 'rifle');

export function WeaponArt({ kind, className = '' }: { kind: WeaponKind; className?: string }) {
  return (
    <svg className={`wpn ${className}`} viewBox="0 0 128 36" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d={SHAPES[kind]} />
      {/* a highlight along the top edge, like light catching the finish */}
      <path className="wpn-hi" d={SHAPES[kind]} />
    </svg>
  );
}
