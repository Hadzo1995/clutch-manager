/**
 * The collectible player card: the big card for case reveals and the player page.
 *
 * A chamfered frame in the rarity's colour (bronze to legend), the player's photo full-bleed,
 * their OVR, role, tier and six key attributes. Gold and up carry a foil that catches the light
 * as the card tilts under the pointer; Elite and Legend are holographic. A card can flip in from
 * its back, which the case reveal uses.
 */
import { useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { cardAttributes, cardOvr } from '../../engine/ratings';
import { ROLE_LABEL } from '../../engine/types';
import type { Attribute, OwnedCard, PlayerProfile, Role } from '../../engine/types';
import { playerJersey } from '../../engine/data/realTeams';
import { Avatar } from '../avatar/Avatar';
import { CountryTag, OrgTag, RARITY_LABEL, RoleIcon, Stars, TierChip } from '../common';
import { reducedMotion } from '../motion';
import { WeaponArt, weaponFor } from '../screens/caseArt';
import '../styles/cards.css';

const RARITY_HEX = { bronze: '#c08552', silver: '#a9b6c4', gold: '#e3b23c', elite: '#49b6ff', legend: '#d46cff' } as const;

/** Six attributes that say the most about a player at a glance; the second follows the role. */
function keyAttributes(role: Role): { key: Attribute; label: string }[] {
  return [
    { key: 'aim', label: 'Aim' },
    role === 'awp' ? { key: 'awp', label: 'AWP' } : role === 'igl' ? { key: 'leadership', label: 'Lead' } : { key: 'entry', label: 'Entry' },
    { key: 'utility', label: 'Util' },
    { key: 'clutch', label: 'Clutch' },
    { key: 'gameSense', label: 'Sense' },
    { key: 'teamwork', label: 'Team' },
  ];
}

export function CollectibleCard({ profile, card, size = 'lg', intro = 'none', delay = 0, tilt = true, ovr: ovrShown, className = '', onClick }: {
  profile: PlayerProfile;
  /** The owned card, for its developed attributes, OVR and stars. */
  card?: OwnedCard;
  size?: 'lg' | 'md';
  /** 'flip' turns the card over from its back, 'rise' lifts it in. */
  intro?: 'none' | 'flip' | 'rise';
  /** Milliseconds before the intro starts. */
  delay?: number;
  /** Tilt towards the pointer (off for reduced motion and touch). */
  tilt?: boolean;
  /** Overrides the OVR shown, e.g. a count-up during a reveal. */
  ovr?: number;
  className?: string;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const p = profile;
  const attrs = card ? cardAttributes(p, card) : p.base;
  const ovr = ovrShown ?? (card ? cardOvr(p, card) : p.ovr);
  const role = card?.roleOverride ?? p.record.primaryRole;
  const foil = p.rarity === 'legend' ? 'holo' : p.rarity === 'elite' ? 'holo' : p.rarity === 'gold' ? 'gold' : 'none';

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tilt || e.pointerType === 'touch' || reducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${((x - 0.5) * 18).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    el.classList.add('tilting');
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--mx', '50%');
    el.style.setProperty('--my', '30%');
    el.classList.remove('tilting');
  };

  const style = { ['--rc' as string]: RARITY_HEX[p.rarity], ['--delay' as string]: `${delay}ms` } as CSSProperties;
  const label = `${p.record.handle}, ${RARITY_LABEL[p.rarity]} card, ${ovr} OVR, ${ROLE_LABEL[role]}`;
  const Tag = onClick ? 'button' : 'div';
  return (
    <div ref={ref} className={`col-card ${size} r-${p.rarity} foil-${foil} intro-${intro} ${className}`} style={style} onPointerMove={move} onPointerLeave={leave}>
      <Tag className="col-body" {...(onClick ? { type: 'button' as const, onClick } : {})} aria-label={label}>
        <div className="col-face col-front">
          <WeaponArt kind={weaponFor(p.record.primaryRole)} className="col-wpn" />
          <i className="col-dots" aria-hidden="true" />
          <div className="col-photo"><Avatar seed={p.record.id} size={size === 'lg' ? 320 : 240} accent={RARITY_HEX[p.rarity]} jersey={playerJersey(p.record.team)} eager /></div>
          <i className="col-shade" aria-hidden="true" />
          <div className="col-top">
            <span className="col-ovr num">{ovr}<small>OVR</small></span>
            <span className="col-role" title={ROLE_LABEL[role]}><RoleIcon role={role} /></span>
            <TierChip tier={p.tier} cap={p.potential} />
          </div>
          <div className="col-plate">
            <span className="col-rarity">{RARITY_LABEL[p.rarity]}</span>
            <b className="col-name">{p.record.handle}</b>
            <span className="col-meta"><CountryTag cc={p.record.country} /><OrgTag team={p.record.team} /><span className="col-rolename">{ROLE_LABEL[role]}</span></span>
          </div>
          <dl className="col-attrs">
            {keyAttributes(role).map((a) => (
              <div key={a.key}><dt>{a.label}</dt><dd className="num">{Math.round(attrs[a.key])}</dd></div>
            ))}
          </dl>
          {card && card.stars > 0 && <div className="col-stars"><Stars n={card.stars} /></div>}
          <i className="col-foil" aria-hidden="true" />
          <i className="col-glare" aria-hidden="true" />
          <svg className="col-frame" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="6,0.8 94,0.8 99.2,6 99.2,134 94,139.2 6,139.2 0.8,134 0.8,6" />
            <polygon className="inner" points="7.5,3 92.5,3 97,7.5 97,132.5 92.5,137 7.5,137 3,132.5 3,7.5" />
          </svg>
        </div>
        <div className="col-face col-back" aria-hidden="true">
          <svg viewBox="0 0 32 32" className="col-back-mark">
            <path d="M8 2 H24 L30 8 V24 L24 30 H8 L2 24 V8 Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M16 5.5 V11 M16 21 V26.5 M5.5 16 H11 M21 16 H26.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
      </Tag>
    </div>
  );
}
