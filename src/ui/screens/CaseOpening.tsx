import { cloneElement, isValidElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import { playerJersey } from '../../engine/data/realTeams';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { CASES, caseTable } from '../../engine/cases';
import type { CaseRow } from '../../engine/cases';
import type { CaseId, CaseOutcome } from '../../engine/cases';
import { marketValue } from '../../engine/economy';
import { MAX_STARS } from '../../engine/ratings';
import { ROLE_LABEL } from '../../engine/types';
import type { PlayerProfile, Rarity, Role } from '../../engine/types';
import { Avatar, playerPhotoUrl } from '../avatar/Avatar';
import { Coin, CountryTag, OrgTag, RARITY_LABEL, RoleIcon, Stars, TierChip, fmt } from '../common';
import { RARITY_HEX, Sparks, TIER, caseAudio, prefersReducedMotion, useCountUp } from './caseFx';
import type { CaseAudio } from './caseFx';
import { WeaponArt, weaponFor } from './caseArt';
import { ITEM_W, SPIN_MS, STRIDE, WIN_INDEX, buildReel, reelEase, reelPath, reelSpeed, tileAt } from './caseReel';
import '../styles/caseOpen.css';

/*
 * Opening a case the way CS2 does it, as a full-screen sequence:
 *  1. Inspect: the case lit on a pedestal, "Contains one of the following" with exact odds, Unlock.
 *     Nothing is charged until Unlock is pressed, so closing here is free.
 *  2. Unlock: latches pop and the lid lifts (the drop is already decided by the engine).
 *  3. Roll: a strip of players, each over their weapon, accelerates under a fixed marker, glides
 *     and slows to a stop exactly on the drop. Each tile crossing the marker ticks.
 *  4. Reveal: the drop large in its rarity colour, with its value and what happened to the squad.
 */

const SOUND_KEY = 'cm-case-sound';
const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };

type Stage = 'inspect' | 'open' | 'spin' | 'reveal';
const OPEN_MS = 950;
const LAND_HOLD_MS = 900;

const ReelItem = memo(function ReelItem({ profile }: { profile: PlayerProfile }) {
  return (
    <div className={`co-item r-${profile.rarity}`} style={{ width: ITEM_W }}>
      <WeaponArt kind={weaponFor(profile.record.primaryRole)} className="co-item-wpn" />
      <div className="co-item-face"><Avatar seed={profile.record.id} size={88} accent={RARITY_HEX[profile.rarity]} jersey={playerJersey(profile.record.team)} eager /></div>
      <div className="co-item-txt">
        <b className="co-item-name">{profile.record.handle}</b>
        <span className="co-item-sub">{ROLE_LABEL[profile.record.primaryRole]} · <span className="num">{profile.ovr}</span></span>
      </div>
      <i className="co-item-bar" aria-hidden="true" />
    </div>
  );
});

/** Which tiers make up each rarity (see RARITY_OF_TIER in ratings.ts). */
const RARITY_TIERS: Record<Rarity, string> = { legend: 'S+++ / S++', elite: 'S+', gold: 'S', silver: 'A', bronze: 'B' };

/** A probability for people: "3%", "0.5%", "0.033%". */
export function pct(x: number): string {
  if (x >= 10) return `${Math.round(x * 10) / 10}%`;
  if (x >= 1) return `${Math.round(x * 100) / 100}%`;
  const digits = Math.max(2, 1 - Math.floor(Math.log10(x)));
  return `${x.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** "Contains one of the following": every rarity, its exact chance, and each player's own chance. */
function Contents({ table, total }: { table: CaseRow[]; total: number }) {
  const [all, setAll] = useState(false);
  const rows = [...table].sort((a, b) => TIER[b.rarity] - TIER[a.rarity]);
  return (
    <div className="co-table">
      {rows.map((r) => (
        <div key={r.rarity} className={`co-row r-${r.rarity}`}>
          <div className="co-row-head">
            <span className="co-row-name"><i aria-hidden="true" />{RARITY_LABEL[r.rarity]} <small>{RARITY_TIERS[r.rarity]}</small></span>
            <b className="num">{pct(r.chance)}</b>
            <span className="co-row-sub small faint">{r.players.length} players · {pct(r.perPlayer)} each</span>
          </div>
          <div className="co-row-faces">
            {(all ? r.players : r.players.slice(0, 7)).map((p) => (
              <span key={p.record.id} className="co-face" title={`${p.record.handle} · ${ROLE_LABEL[p.record.primaryRole]} · ${p.tier} · ${pct(r.perPlayer)}`}>
                <Avatar seed={p.record.id} size={34} accent="#f0a33a" jersey={playerJersey(p.record.team)} />
                {all && <small>{p.record.handle}</small>}
              </span>
            ))}
            {!all && r.players.length > 7 && <span className="co-more small faint">+{r.players.length - 7}</span>}
          </div>
        </div>
      ))}
      <button className="btn small ghost co-all" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${total} players`}</button>
    </div>
  );
}

export function CaseOpening({ caseId, pool, role, crate, caseColor, balance, onUnlock, onClose, onView, onCollection }: {
  caseId: CaseId;
  /** The chosen role, for a role case: the contents, odds and strip only show that role. */
  role?: Role;
  /** The case's colour (CSS), used by the case artwork and the stage lighting. */
  caseColor: string;
  pool: PlayerProfile[];
  /** The case artwork; it receives `open` for the unlock beat. */
  crate: ReactNode;
  /** Club balance, to offer "Open another" only when it is affordable. */
  balance: number;
  /** Charges the case and returns the drop, or null if it could not be opened (the caller explains why). */
  onUnlock: () => CaseOutcome | null;
  onClose: () => void;
  onView: (outcome: CaseOutcome) => void;
  /** Leaves the opening for the squad's collection. */
  onCollection: () => void;
}) {
  const def = CASES[caseId];
  const [stage, setStage] = useState<Stage>('inspect');
  const [outcome, setOutcome] = useState<CaseOutcome | null>(null);
  const [opened, setOpened] = useState(0);
  const [sound, setSound] = useState(soundOn);
  const stripRef = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const audio = useRef<CaseAudio | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const busy = useRef(false);
  const skip = useRef<() => void>(() => {});
  const play = (f: (a: CaseAudio) => void) => { if (soundRef.current && audio.current) f(audio.current); };

  useEffect(() => () => audio.current?.close(), []);
  // The page behind stays put while the case is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // The same table the roll uses (engine/cases.ts), so the odds shown are the odds played.
  const table = useMemo(() => caseTable(def, pool, role), [def, pool, role]);
  const total = table.reduce((s, r) => s + r.players.length, 0);
  const reel = useMemo(() => (outcome ? buildReel(Date.now() ^ (opened * 7919), def, pool, role, outcome.profile) : []), [outcome, opened, def, pool, role]);

  // Fetch the strip's photos during the unlock beat, so no tile rolls past empty.
  useEffect(() => {
    for (const p of reel) {
      const src = playerPhotoUrl(p.record.id);
      if (src) { const im = new Image(); im.decoding = 'async'; im.src = src; }
    }
  }, [reel]);

  const unlock = () => {
    if (busy.current) return; // a double click must never charge twice
    busy.current = true;
    // Audio needs a user gesture on phones, so it starts here rather than on mount.
    if (!audio.current) audio.current = caseAudio();
    const o = onUnlock();
    if (!o) { busy.current = false; return; }
    setOutcome(o);
    setOpened((n) => n + 1);
    if (prefersReducedMotion()) { busy.current = false; setStage('reveal'); return; }
    setStage('open');
  };

  useEffect(() => {
    if (stage !== 'open') return;
    play((a) => { a.latch(0); window.setTimeout(() => a.latch(1), 110); window.setTimeout(() => a.burst(), 360); });
    const t = window.setTimeout(() => setStage('spin'), OPEN_MS);
    return () => window.clearTimeout(t);
  }, [stage]);

  // The roll, driven frame by frame: position from the speed profile, a tick per tile crossing.
  useEffect(() => {
    if (stage !== 'spin') return;
    const { from, to } = reelPath(Math.random());
    const reelEl = reelRef.current;
    let raf = 0, start = 0, lastIdx = tileAt(from), finished = false;
    const place = (px: number, speed: number) => {
      if (stripRef.current) stripRef.current.style.transform = `translate3d(${-px}px,0,0)`;
      if (reelEl) reelEl.style.setProperty('--speed', speed.toFixed(3));
      const idx = tileAt(px);
      if (idx !== lastIdx) { lastIdx = idx; play((a) => a.tick(speed)); }
    };
    const finish = (instant: boolean) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      place(to, 0);
      play((a) => a.land());
      // The winning tile lights up in its rarity colour, then the reveal takes over.
      stripRef.current?.children[WIN_INDEX]?.classList.add('won');
      reelEl?.classList.add('landed');
      window.setTimeout(() => { busy.current = false; setStage('reveal'); }, instant ? 250 : LAND_HOLD_MS);
    };
    place(from, 0);
    const frame = (now: number) => {
      if (!start) start = now;
      const u = (now - start) / SPIN_MS;
      if (u >= 1) { finish(false); return; }
      place(from + (to - from) * reelEase(u), reelSpeed(u));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    skip.current = () => finish(true);
    // Browsers pause animation frames in background tabs; this makes sure the roll still ends.
    const guard = window.setTimeout(() => finish(true), SPIN_MS + 1500);
    return () => { finished = true; cancelAnimationFrame(raf); window.clearTimeout(guard); };
  }, [stage, reel]);

  useEffect(() => {
    if (stage === 'reveal' && outcome) play((a) => a.reveal(TIER[outcome.profile.rarity]));
  }, [stage, outcome]);

  // Escape closes when nothing is in motion; during the roll it skips to the stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stage === 'spin') skip.current();
      else if (stage === 'inspect' || stage === 'reveal') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  const toggleSound = () => { const v = !sound; setSound(v); try { localStorage.setItem(SOUND_KEY, v ? 'on' : 'off'); } catch { /* per-viewer convenience only */ } };
  const rarity = outcome?.profile.rarity;
  const style = { ['--cc' as string]: caseColor, ...(rarity ? { ['--rc' as string]: `var(--${rarity})` } : {}) } as CSSProperties;
  const canRepeat = caseId !== 'daily' && !!outcome && !outcome.pendingFull && balance >= def.price;
  const openCrate = isValidElement(crate) ? cloneElement(crate as ReactElement<{ open?: boolean }>, { open: true }) : crate;

  return (
    <div className={`overlay co-overlay at-${stage}`} style={style}>
      <div className="co-stage" role="dialog" aria-modal="true" aria-label={`${def.name}: ${stage === 'inspect' ? 'unlock' : stage === 'reveal' ? 'item received' : 'opening'}`}>
        <div className="co-light" aria-hidden="true" />
        <header className="co-head">
          <div className="co-title">
            <span className="co-kicker">{stage === 'reveal' ? 'Item received' : stage === 'inspect' ? 'Container' : 'Unlocking container'}</span>
            <h2>{def.name}{role ? <span className="co-role"> · {ROLE_LABEL[role]}</span> : null}</h2>
          </div>
          <div className="co-tools">
            <span className="co-bal small"><span className="faint">Balance</span> <Coin amount={balance} /></span>
            <button className="btn small ghost" onClick={toggleSound} aria-pressed={sound} title={sound ? 'Mute case sounds' : 'Turn case sounds on'}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" />{sound ? <path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" /> : <path d="M17 9l5 6M22 9l-5 6" />}</svg>
              <span>{sound ? 'Sound' : 'Muted'}</span>
            </button>
            {stage === 'spin' && <button className="btn small ghost" onClick={() => skip.current()}>Skip</button>}
            {(stage === 'inspect' || stage === 'reveal') && <button className="btn small ghost co-x" onClick={onClose} aria-label="Close">✕</button>}
          </div>
        </header>

        {stage === 'inspect' && (
          <div className="co-inspect">
            <div className="co-showcase">
              <div className="co-pedestal" aria-hidden="true"><i className="co-cone" /><div className="co-float">{crate}</div><i className="co-disc" /></div>
              <div className="co-pitch">
                <p className="small muted">{def.description}</p>
                <div className="co-odds-bar" aria-hidden="true">
                  {[...table].sort((a, b) => TIER[b.rarity] - TIER[a.rarity]).map((r) => <i key={r.rarity} style={{ flexGrow: r.chance, background: `var(--${r.rarity})` }} />)}
                </div>
                <span className="small faint">{total} players{role ? ` (${ROLE_LABEL[role]}s only)` : ''} · duplicates add a star</span>
              </div>
            </div>
            <div className="co-contents">
              <span className="co-label">Contains one of the following:</span>
              <Contents table={table} total={total} />
            </div>
            <div className="co-unlock-row">
              <span className="small faint">{caseId === 'daily' ? 'Free once a day.' : <>After unlocking: <Coin amount={balance - def.price} /></>}</span>
              <button className="btn primary co-unlock" onClick={unlock}>
                {caseId === 'daily' ? 'Unlock container' : <>Unlock container · <Coin amount={def.price} /></>}
              </button>
            </div>
          </div>
        )}

        {stage === 'open' && (
          <div className="co-unlocking" aria-hidden="true">
            <div className="co-unlock-beam" />
            <div className="co-unlock-crate">{openCrate}</div>
          </div>
        )}

        {stage === 'spin' && (
          <div className="co-spin">
            <div className="co-reel" ref={reelRef}>
              <div className="co-strip" ref={stripRef} style={{ gap: STRIDE - ITEM_W }}>
                {reel.map((x, i) => <ReelItem key={`${opened}-${i}`} profile={x} />)}
              </div>
              <i className="co-streak" aria-hidden="true" />
              <div className="co-line" aria-hidden="true" />
            </div>
            <p className="co-spin-note small faint">The drop was decided when you unlocked the case. The strip only shows it.</p>
          </div>
        )}

        {stage === 'reveal' && outcome && <Reveal key={opened} outcome={outcome} table={table}
          onView={() => onView(outcome)} onDone={onClose} onCollection={onCollection}
          repeat={canRepeat ? { price: def.price, go: unlock } : null} />}
      </div>
    </div>
  );
}

function Reveal({ outcome, table, onView, onDone, onCollection, repeat }: {
  outcome: CaseOutcome; table: CaseRow[]; onView: () => void; onDone: () => void; onCollection: () => void;
  repeat: { price: number; go: () => void } | null;
}) {
  const p = outcome.profile;
  const tier = TIER[p.rarity];
  const ovr = useCountUp(p.ovr, 700, 250, true);
  const row = table.find((x) => x.rarity === p.rarity);
  const value = marketValue(p);
  const status = outcome.pendingFull
    ? { tone: 'warn', head: 'Squad full', text: `You have 5 starters and 3 on the bench. Sell a benched player to sign ${p.record.handle}, or sell the pull straight away.` }
    : outcome.duplicate
    ? outcome.refund
      ? { tone: 'good', head: 'Duplicate · max stars', text: `${p.record.handle} is already at ${MAX_STARS} stars, so the copy became ${fmt(outcome.refund)} coins.` }
      : { tone: 'good', head: `Duplicate · ${outcome.starsNow} star${outcome.starsNow === 1 ? '' : 's'}`, text: `${p.record.handle} gains a star, which raises their development ceiling.` }
    : { tone: 'good', head: 'New signing', text: `Added to your collection. New cards start at 60 sharpness, so train them before they peak.` };
  return (
    <div className={`co-result r-${p.rarity} t${tier}`} role="status">
      <Sparks burst={1} tier={tier} colors={[RARITY_HEX[p.rarity], '#ffffff', '#ffd27a']} origin={[0.3, 0.45]} embers={tier >= 3} className="co-sparks" />
      <div className="co-drop">
        <div className="co-rays" aria-hidden="true" />
        <div className="co-card">
          <WeaponArt kind={weaponFor(p.record.primaryRole)} className="co-card-wpn" />
          <div className="co-card-top">
            <span className="co-card-ovr num">{ovr}<small>OVR</small></span>
            <TierChip tier={p.tier} cap={p.potential} />
            <span className="co-card-role" title={ROLE_LABEL[p.record.primaryRole]}><RoleIcon role={p.record.primaryRole} /></span>
          </div>
          <div className="co-card-face"><Avatar seed={p.record.id} size={176} accent={RARITY_HEX[p.rarity]} jersey={playerJersey(p.record.team)} /></div>
          <div className="co-card-name">{p.record.handle}</div>
          <div className="co-card-meta"><CountryTag cc={p.record.country} /><OrgTag team={p.record.team} /></div>
          <i className="co-card-bar" aria-hidden="true" />
        </div>
      </div>
      <div className="co-info">
        <span className="co-rarity">{RARITY_LABEL[p.rarity]} drop</span>
        <h1 className="co-name">{p.record.handle}</h1>
        <div className="co-sub"><RoleIcon role={p.record.primaryRole} /> {ROLE_LABEL[p.record.primaryRole]} <span className="faint">/ {ROLE_LABEL[p.record.secondaryRole]}</span> · <OrgTag team={p.record.team} full /> · {p.record.age}y</div>
        <dl className="co-stats">
          <div><dt>Overall</dt><dd className="num">{p.ovr}</dd></div>
          <div><dt>Max cap</dt><dd className="num">{p.potential}</dd></div>
          <div><dt>Market value</dt><dd><Coin amount={value} /></dd></div>
          <div><dt>Odds</dt><dd className="num">{row ? pct(row.perPlayer) : '—'}</dd></div>
        </dl>
        <div className={`co-status ${status.tone}`}>
          <strong>{status.head}</strong>
          {outcome.duplicate && !outcome.refund && <Stars n={outcome.starsNow} />}
          <span className="small muted">{status.text}</span>
        </div>
        {row && <span className="co-chance small faint">{RARITY_LABEL[p.rarity]} chance {pct(row.chance)} · {row.players.length} {RARITY_LABEL[p.rarity]} players in this case</span>}
        <div className="co-btns">
          {outcome.pendingFull ? (
            <button className="btn primary" onClick={onDone}>Choose what to do</button>
          ) : (
            <>
              <button className="btn primary" onClick={onDone}>Continue</button>
              {repeat ? <button className="btn" onClick={repeat.go}>Open another · <Coin amount={repeat.price} /></button> : null}
              <button className="btn ghost" onClick={onView}>Inspect player</button>
              <button className="btn ghost" onClick={onCollection}>Go to collection</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
