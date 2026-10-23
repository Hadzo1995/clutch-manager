import { Avatar } from './avatar/Avatar';
import './styles/team.css';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Career, World } from '../engine/career';
import { profileOf } from '../engine/career';
import { cardOvr, effectiveOvr } from '../engine/ratings';
import type { OwnedCard, PlayerProfile, Rarity, Role } from '../engine/types';
import { ROLE_LABEL } from '../engine/types';
import { realTeamMeta } from '../engine/data/realTeams';
import { Crest } from './crest';

// ---------- Game context ----------

export interface Game {
  world: World;
  career: Career;
  update: (next: Career, toast?: string) => void;
  toast: (msg: string) => void;
  openPlayer: (cardId: string | null, playerId?: string) => void;
  openClub: () => void;
}

export const GameCtx = createContext<Game | null>(null);
export function useGame(): Game {
  const g = useContext(GameCtx);
  if (!g) throw new Error('GameCtx missing');
  return g;
}

// ---------- Formatting ----------

/** Country as a small code tag (flag emoji render as plain letters on some systems, so none are used). */
export function CountryTag({ cc }: { cc: string }) {
  const code = /^[A-Z]{2}$/.test(cc) && cc !== 'UN' ? cc : '—';
  return <span className="cc-tag" title={`Country: ${code}`}>{code}</span>;
}

/** A real player's organisation in the snapshot: its badge and tag (nothing for fictional players). */
export function OrgTag({ team, full = false }: { team?: string; full?: boolean }) {
  if (!team) return null;
  const m = realTeamMeta(team);
  return (
    <span className="org-tag" title={`Real-world team: ${m.name} (standings snapshot)`} style={{ ['--org' as string]: m.primary, ['--org-accent' as string]: m.accent }}>
      <Crest name={m.name} tag={m.tag} size={16} />
      <span>{full ? m.name : m.tag}</span>
    </span>
  );
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export const RARITY_LABEL: Record<Rarity, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', elite: 'Elite', legend: 'Legend' };

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Icons ----------

export function RoleIcon({ role, className = 'role-ico' }: { role: Role; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (role) {
    case 'awp': return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></svg>;
    case 'entry': return <svg {...common}><path d="M4 12h13M12 6l6 6-6 6" /></svg>;
    case 'support': return <svg {...common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>;
    case 'lurker': return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case 'igl': return <svg {...common}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>;
  }
}

export function TabIcon({ name }: { name: 'home' | 'squad' | 'train' | 'scout' | 'cases' | 'league' | 'pvp' }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'home': return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" /></svg>;
    case 'squad': return <svg {...p}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 15.2c.6-.1 1.3-.2 2-.2 3 0 6 2 6 5" /></svg>;
    case 'train': return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>;
    case 'scout': return <svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" /></svg>;
    case 'cases': return <svg {...p}><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M9 7V5h6v2M3 12h18M11 12v2h2v-2" /></svg>;
    case 'pvp': return <svg {...p}><path d="M4 4l7 7M4 4v4M4 4h4M20 4l-7 7M20 4v4M20 4h-4M8 14l-4 4 2 2 4-4M16 14l4 4-2 2-4-4" /></svg>;
    case 'league': return <svg {...p}><path d="M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 13v4M8 21h8M9 17h6" /></svg>;
  }
}

export function Coin({ amount }: { amount: number }) {
  return <span className="coins"><span className="coin-dot" aria-hidden="true" />{fmt(amount)}</span>;
}

export function Bar({ value, max = 100, tone = '' }: { value: number; max?: number; tone?: string }) {
  return <div className={`bar ${tone}`}><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>;
}

// ---------- Player cards ----------

export function Stars({ n }: { n: number }) {
  return (
    <div className="stars" role="img" aria-label={`${n} of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < n ? 'on' : ''} aria-hidden="true" />)}
    </div>
  );
}

/** Rating badge tinted by rarity: the single most important number on any player surface. */
export function OvrBadge({ value, rarity, size = 'md', label = 'OVR' }: { value: number; rarity?: Rarity; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <span className={`ovr-badge ${size} ${rarity ?? ''}`} aria-label={`${label} ${value}`}>
      <b className="num">{value}</b>
      {size !== 'sm' && <small>{label}</small>}
    </span>
  );
}

export function RarityChip({ rarity }: { rarity: Rarity }) {
  return <span className={`rarity-chip ${rarity}`}>{RARITY_LABEL[rarity]}</span>;
}

export function PlayerCard({ world, card, profile, compact = false, selected = false, onClick, roleOverride, children }: {
  world?: World; card?: OwnedCard; profile?: PlayerProfile; compact?: boolean; selected?: boolean; onClick?: () => void; roleOverride?: Role; children?: ReactNode;
}) {
  const p = profile ?? (world && card ? profileOf(world, card) : undefined);
  if (!p) return null;
  const ovr = card ? cardOvr(p, card) : p.ovr;
  const eff = card ? effectiveOvr(p, card) : null;
  const role = roleOverride ?? p.record.primaryRole;
  const body = (
    <>
      <div className="pc-top">
        <div className="pc-ovr">
          <span className="ovr">{ovr}</span>
          <span className="rarity-label">{RARITY_LABEL[p.rarity]}</span>
          <span className="pc-role" title={ROLE_LABEL[role]}><RoleIcon role={role} /></span>
        </div>
        <div className="pcard-face"><Avatar seed={p.record.id} size={compact ? 64 : 76} accent="#f0a33a" /></div>
      </div>
      <div className="pc-name">
        <div className="handle">{p.record.handle}</div>
        <div className="meta">
          <CountryTag cc={p.record.country} />
          <OrgTag team={p.record.team} />
          <span>{ROLE_LABEL[role]}</span>
          {card && <Stars n={card.stars} />}
        </div>
      </div>
      {card && !compact && (
        <div className="sharp" title="Sharpness: rises when the player trains and plays, drops when idle">
          <span>Sharp</span>
          <Bar value={card.sharpness} tone={card.sharpness >= 70 ? 'good' : card.sharpness < 35 ? 'bad' : 'warn'} />
          <span className="num">{Math.round(card.sharpness)}</span>
        </div>
      )}
      {eff !== null && !compact && <div className="small faint">Plays at <span className="num">{eff}</span></div>}
      {selected && <span className="pc-tick" aria-label="Selected">✓</span>}
      {children}
    </>
  );
  const cls = `pcard pc ${p.rarity}${compact ? ' compact' : ''}${selected ? ' selected' : ''}`;
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}
