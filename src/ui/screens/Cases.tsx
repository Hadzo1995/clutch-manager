import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { benchCards, canClaimDaily, openCase, profileOf, pullSalePrice, resolvePull, salePrice } from '../../engine/career';
import { CASES, caseTable } from '../../engine/cases';
import type { CaseId, CaseOutcome } from '../../engine/cases';
import { RARITIES, ROLES, ROLE_LABEL } from '../../engine/types';
import type { Role } from '../../engine/types';
import { Coin, RARITY_LABEL, RoleIcon, today, useGame } from '../common';
import { CaseOpening, pct } from './CaseOpening';
import '../styles/cases.css';

const CASE_COLOR: Record<CaseId, string> = { daily: 'var(--good)', standard: 'var(--ct)', role: 'var(--t)', premium: 'var(--legend)' };
const caseStyle = (id: CaseId) => ({ ['--cc' as string]: CASE_COLOR[id] } as CSSProperties);

export function Cases() {
  const { world, career: c, update, toast, openPlayer } = useGame();
  const [role, setRole] = useState<Role>('awp');
  const [opening, setOpening] = useState<CaseId | null>(null);
  const daily = canClaimDaily(c, today());

  // Charging happens on Unlock inside the opening screen, as in CS2; closing before that is free.
  const unlock = (id: CaseId): CaseOutcome | null => {
    try {
      const { career, outcome } = openCase(world, c, id, { role, today: today() });
      update(career);
      return outcome;
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
  };
  const view = (o: CaseOutcome) => {
    const cardId = o.newCard?.cardId ?? c.cards.find((x) => x.playerId === o.profile.record.id)?.cardId;
    if (cardId) openPlayer(cardId);
    setOpening(null);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Cases</h1>
          <p className="sub">Every case draws from all {world.profileList.length} players with fixed, published odds: rarity follows the player's tier (Legend = S+++/S++, Elite = S+, Gold = S, Silver = A, Bronze = B), and every player within a rarity is equally likely. Duplicates add a star. Cases cost in-game coins only.</p>
        </div>
        <div className="cs-balance"><span className="small faint">Balance</span><Coin amount={c.coins} /></div>
      </header>
      {(Object.keys(CASES) as CaseId[]).map((id) => {
        const def = CASES[id];
        const disabled = id === 'daily' ? !daily : c.coins < def.price;
        const short = id !== 'daily' && c.coins < def.price ? def.price - c.coins : 0;
        return (
          <section className={`panel cs-case span-6 ${id}`} key={id} style={caseStyle(id)} aria-label={def.name}>
            <div className="cs-top">
              <div className="cs-art3d" aria-hidden="true"><i className="cs-pedestal" /><Crate variant={id} role={def.needsRole ? role : undefined} /></div>
              <div className="cs-info">
                <h2>{def.name}</h2>
                <p className="small muted">{def.description}</p>
              </div>
            </div>
            {def.needsRole && (
              <div className="seg compact" role="group" aria-label="Role for the Role Case">
                {ROLES.map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>)}
              </div>
            )}
            <div className="cs-odds" aria-label="Drop odds">
              <div className="cs-odds-bar" aria-hidden="true">
                {[...RARITIES].reverse().map((r) => def.odds[r] > 0 && <i key={r} style={{ flexGrow: def.odds[r], background: `var(--${r})` }} />)}
              </div>
              <div className="cs-odds-legend">
                {[...RARITIES].reverse().map((r) => (
                  <span key={r} className={def.odds[r] ? '' : 'zero'}><i style={{ background: `var(--${r})` }} />{RARITY_LABEL[r]} <b className="num">{def.odds[r]}%</b></span>
                ))}
              </div>
              {(() => {
                // The case's best prize, from the same table the roll uses.
                const t = caseTable(def, world.profileList, def.needsRole ? role : undefined);
                const top = t.find((x) => x.rarity === 'legend');
                const n = t.reduce((s, x) => s + x.players.length, 0);
                return <p className="cs-odds-note small faint">{n} players{def.needsRole ? ` (${ROLE_LABEL[role]}s)` : ''} · {top ? <>any one Legend {pct(top.perPlayer)}</> : 'no Legends'}</p>;
              })()}
            </div>
            <div className="cs-foot">
              <span className="small faint">{id === 'daily' ? (daily ? 'Free once a day' : 'Already claimed today') : short ? `${short.toLocaleString('en-US')} coins short` : 'Charged when you unlock'}</span>
              <button className={`btn ${id === 'daily' || !disabled ? 'primary' : ''}`} disabled={disabled} onClick={() => setOpening(id)}>
                {id === 'daily' ? (daily ? 'Claim' : 'Tomorrow') : <>Open · <Coin amount={def.price} /></>}
              </button>
            </div>
          </section>
        );
      })}
      {c.pendingPull && !opening && <PullChoice />}
      {opening && <CaseOpening caseId={opening} caseColor={CASE_COLOR[opening]} pool={world.profileList} role={CASES[opening].needsRole ? role : undefined} crate={<Crate variant={opening} role={CASES[opening].needsRole ? role : undefined} />} onUnlock={() => unlock(opening)} onClose={() => setOpening(null)} onView={view} />}
    </>
  );
}


/** A case pull that arrived with a full squad: sell a benched player for it, or sell the pull. */
function PullChoice() {
  const { world, career: c, update, toast } = useGame();
  const pend = c.pendingPull!;
  const p = world.profiles.get(pend.playerId)!;
  const act = (choice: Parameters<typeof resolvePull>[2]) => {
    try { update(resolvePull(world, c, choice)); } catch (e) { toast((e as Error).message); }
  };
  const bench = benchCards(c);
  return (
    <div className="overlay">
      <div className="sheet" role="dialog" aria-label="Squad full: choose what to do with your pull">
        <div className="sheet-head"><h2>Squad full</h2></div>
        <p className="muted small">Your {pend.caseName} gave you <b>{p.record.handle}</b> ({RARITY_LABEL[p.rarity]}, {p.ovr} OVR, {ROLE_LABEL[p.record.primaryRole]}). You have 5 starters and 3 on the bench.</p>
        <div className="stack" style={{ gap: 8 }}>
          {bench.map((card) => {
            const bp = profileOf(world, card);
            return (
              <button key={card.cardId} className="btn" onClick={() => act({ sellCardId: card.cardId })}>
                <RoleIcon role={bp.record.primaryRole} /> Sell {bp.record.handle} ({bp.ovr}) for <Coin amount={salePrice(world, card)} /> and sign {p.record.handle}
              </button>
            );
          })}
          {bench.length === 0 && <p className="small faint">All your players are in the starting five, so nobody can be sold for this pull.</p>}
          <button className="btn primary" onClick={() => act('sell-pull')}>Sell {p.record.handle} now for <Coin amount={pullSalePrice(world, pend.playerId)} /></button>
        </div>
      </div>
    </div>
  );
}

const CASE_STENCIL: Record<CaseId, string> = { daily: 'DAILY', standard: 'SCOUT', role: 'ROLE', premium: 'MAJOR' };

/**
 * A hard-shell weapon case in three-quarter view (SVG), coloured by --cc. Each case has its own
 * finish: Daily a sticker, Scout straps, Role hazard stripes and the chosen role, Major gilded and foiled.
 * The seam glows as if something bright is inside; with `open` the lid is animated off by CSS.
 */
function Crate({ open = false, variant = 'standard', role }: { open?: boolean; variant?: CaseId; role?: Role }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className={`crate v-${variant}${open ? ' open' : ''}`} viewBox="0 0 128 100" aria-hidden="true">
      <defs>
        <clipPath id={`${uid}f`}><path d="M10 50 H96 V86 H10 Z M10 40 H96 V50 H10 Z" /></clipPath>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.65" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse className="cr-shadow" cx="62" cy="91" rx="54" ry="6" />
      {/* light escaping through the open seam (visible when the lid lifts) */}
      <path className="cr-leak" d="M12 50 L34 30 H116 L96 50 Z" />
      {/* body */}
      <path className="cr-front" d="M10 50 H96 V86 H10 Z" />
      <path className="cr-side" d="M96 50 L118 38 V74 L96 86 Z" />
      <path className="cr-rib" d="M14 62 H92 M14 70 H92 M14 78 H92" />
      <path className="cr-rib side" d="M99 60 L115 51 M99 68 L115 59 M99 76 L115 67" />
      {variant === 'standard' && <path className="cr-strap" d="M24 50 V86 M82 50 V86" />}
      {variant === 'role' && <path className="cr-hazard" d="M10 80 L16 86 M16 80 L22 86 M22 80 L28 86 M78 80 L84 86 M84 80 L90 86 M90 80 L96 86" />}
      {variant === 'daily' && <g className="cr-sticker"><circle cx="24" cy="70" r="8" /><path d="M24 65 V70 L27.5 72" /></g>}
      {variant === 'premium' && <path className="cr-gild" d="M10 50 H96 V86 H10 Z M96 50 L118 38 V74 L96 86" />}
      <text className="cr-stencil" x="88" y="83" textAnchor="end">{CASE_STENCIL[variant]}</text>
      <path className="cr-edge" d="M10 86 H96 L118 74" />
      <rect className="cr-plate" x="40" y="64" width="26" height="14" rx="2" />
      <path className="cr-gem" d="M53 66.5 L57.5 71 L53 75.5 L48.5 71 Z" />
      {role && <svg className="cr-role" x="100" y="54" width="14" height="14" viewBox="0 0 24 24"><RoleIcon role={role} className="" /></svg>}
      <path className="cr-seam" d="M10 50 H96 L118 38" />
      {/* lid */}
      <g className="cr-lid">
        <path className="cr-top" d="M10 40 L32 28 H118 L96 40 Z" />
        <path className="cr-front lid" d="M10 40 H96 V50 H10 Z" />
        <path className="cr-side lid" d="M96 40 L118 28 V38 L96 50 Z" />
        {variant === 'premium' && <path className="cr-gild" d="M10 40 L32 28 H118 L96 40 Z M10 40 H96 V50 H10 Z" />}
        {variant === 'premium' && <path className="cr-star" d="M64 30 L66 33.6 L70 34 L67 36.6 L68 40 L64 38.2 L60 40 L61 36.6 L58 34 L62 33.6 Z" />}
        <path className="cr-handle" d="M50 34 C50 22 78 22 78 34" />
        <path className="cr-hi" d="M12 40.6 H95" />
      </g>
      <rect className="cr-latch l1" x="20" y="45" width="9" height="10" rx="1.5" />
      <rect className="cr-latch l2" x="77" y="45" width="9" height="10" rx="1.5" />
      <g clipPath={`url(#${uid}f)`}><rect className="cr-sheen" x="-60" y="30" width="80" height="60" fill={`url(#${uid}s)`} /></g>
    </svg>
  );
}
