import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { playerJersey } from '../../engine/data/realTeams';
import type { CSSProperties, ReactNode } from 'react';
import { CASES, rollPlayer } from '../../engine/cases';
import type { CaseId, CaseOutcome } from '../../engine/cases';
import { Rng } from '../../engine/rng';
import { RARITIES, ROLE_LABEL } from '../../engine/types';
import type { PlayerProfile, Rarity } from '../../engine/types';
import { Avatar } from '../avatar/Avatar';
import { Coin, OrgTag, PlayerCard, RARITY_LABEL } from '../common';
import { TIER, caseAudio, prefersReducedMotion } from './caseFx';
import type { CaseAudio } from './caseFx';
import '../styles/caseOpen.css';

/*
 * Opening a case the way CS2 does it, in three steps:
 *  1. Inspect: the case and "Contains one of the following" with its odds, and an Unlock button.
 *     Nothing is charged until Unlock is pressed, so closing here is free.
 *  2. Roll: a horizontal strip of players scrolls under a fixed gold line and slows to a stop
 *     over about six seconds, ticking each time a player passes the line. No bounce, no tease.
 *  3. Reveal: the strip gives way to the drop, shown large with its rarity colour behind it.
 */

const STRIDE = 128; // item width 122 + gap 6
const SPIN_MS = 6000;
const WIN_INDEX = 48;
const REEL_LENGTH = 56;
const SOUND_KEY = 'cm-case-sound';
const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };
// A fast start and a long glide to a stop, like CS2's strip.
const spinEase = (x: number) => 1 - Math.pow(1 - x, 4);

type Stage = 'inspect' | 'spin' | 'reveal';

const ReelItem = memo(function ReelItem({ profile }: { profile: PlayerProfile }) {
  return (
    <div className={`co-item r-${profile.rarity}`}>
      <div className="co-item-face"><Avatar seed={profile.record.id} size={64} accent="#f0a33a" jersey={playerJersey(profile.record.team)} /></div>
      <b className="co-item-name">{profile.record.handle}</b>
      <i className="co-item-bar" aria-hidden="true" />
    </div>
  );
});

/** A few players of each rarity the case can drop, lowest rarity first, as CS2 lists a case's contents. */
function sampleContents(caseId: CaseId, pool: PlayerProfile[]): PlayerProfile[] {
  const def = CASES[caseId];
  const out: PlayerProfile[] = [];
  for (const r of RARITIES as readonly Rarity[]) {
    if (!def.odds[r]) continue;
    const of = pool.filter((p) => p.rarity === r).sort((a, b) => b.ovr - a.ovr);
    out.push(...of.slice(0, r === 'legend' ? 1 : 2));
  }
  return out.sort((a, b) => TIER[a.rarity] - TIER[b.rarity]);
}

export function CaseOpening({ caseId, pool, crate, caseColor, onUnlock, onClose, onView }: {
  caseId: CaseId;
  /** The case's colour (CSS), used by the case artwork. */
  caseColor: string;
  pool: PlayerProfile[];
  /** The case artwork shown on the inspect screen. */
  crate: ReactNode;
  /** Charges the case and returns the drop, or null if it could not be opened (the caller explains why). */
  onUnlock: () => CaseOutcome | null;
  onClose: () => void;
  onView: (outcome: CaseOutcome) => void;
}) {
  const def = CASES[caseId];
  const reduced = prefersReducedMotion();
  const [stage, setStage] = useState<Stage>('inspect');
  const [outcome, setOutcome] = useState<CaseOutcome | null>(null);
  const [sound, setSound] = useState(soundOn);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const audio = useRef<CaseAudio | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const skip = useRef<() => void>(() => {});
  const play = (f: (a: CaseAudio) => void) => { if (soundRef.current && audio.current) f(audio.current); };

  useEffect(() => () => audio.current?.close(), []);

  const contents = useMemo(() => sampleContents(caseId, pool), [caseId, pool]);
  const reel = useMemo(() => {
    if (!outcome) return [];
    const rng = new Rng(Date.now() & 0xffffffff);
    const items = Array.from({ length: REEL_LENGTH }, () => rollPlayer(rng, def, pool));
    items[WIN_INDEX] = outcome.profile;
    return items;
  }, [outcome, def, pool]);

  const unlock = () => {
    // Audio needs a user gesture on phones, so it starts here rather than on mount.
    if (!audio.current) audio.current = caseAudio();
    const o = onUnlock();
    if (!o) return;
    setOutcome(o);
    setStage(reduced ? 'reveal' : 'spin');
  };

  // The roll, driven frame by frame so each player crossing the line ticks.
  useEffect(() => {
    if (stage !== 'spin') return;
    const wrap = wrapRef.current;
    const w = wrap?.clientWidth ?? 360;
    // Stop somewhere inside the winning slot, not always dead centre.
    const inside = 14 + Math.random() * (STRIDE - 34);
    const target = WIN_INDEX * STRIDE + inside - w / 2;
    let raf = 0, start = 0, lastIdx = -1, finished = false;
    const place = (px: number) => {
      if (stripRef.current) stripRef.current.style.transform = `translate3d(${-px}px,0,0)`;
      const idx = Math.floor((px + w / 2) / STRIDE);
      if (idx !== lastIdx) { lastIdx = idx; play((a) => a.tick(0.4)); }
    };
    const finish = () => {
      if (finished) return;
      finished = true; cancelAnimationFrame(raf); place(target);
      play((a) => a.land());
      window.setTimeout(() => setStage('reveal'), 700);
    };
    const frame = (now: number) => {
      if (!start) start = now;
      const t = now - start;
      if (t >= SPIN_MS) { finish(); return; }
      place(target * spinEase(t / SPIN_MS));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    skip.current = () => { finished = true; cancelAnimationFrame(raf); setStage('reveal'); };
    return () => { finished = true; cancelAnimationFrame(raf); };
  }, [stage, reel]);

  useEffect(() => {
    if (stage === 'reveal' && outcome && !reduced) play((a) => a.reveal(TIER[outcome.profile.rarity]));
  }, [stage]);

  const toggleSound = () => { const v = !sound; setSound(v); try { localStorage.setItem(SOUND_KEY, v ? 'on' : 'off'); } catch { /* per-viewer convenience only */ } };
  const rarity = outcome?.profile.rarity;
  const style = { ['--cc' as string]: caseColor, ...(rarity ? { ['--rc' as string]: `var(--${rarity})` } : {}) } as CSSProperties;
  const p = outcome?.profile;

  return (
    <div className={`overlay co-overlay at-${stage}`} style={style}>
      <div className="co-box" role="dialog" aria-label={`${def.name}: ${stage === 'inspect' ? 'unlock' : stage === 'spin' ? 'opening' : 'item received'}`}>
        <header className="co-head">
          <div className="co-title">
            <span className="co-kicker">{stage === 'reveal' ? 'Item received' : stage === 'spin' ? 'Unlocking container' : 'Container'}</span>
            <h2>{def.name}</h2>
          </div>
          <div className="co-tools">
            <button className="btn small ghost" onClick={toggleSound} aria-pressed={sound}>{sound ? 'Sound on' : 'Muted'}</button>
            {stage === 'spin' && <button className="btn small ghost" onClick={() => skip.current()}>Skip</button>}
            {stage !== 'spin' && <button className="btn small ghost" onClick={onClose} aria-label="Close">✕</button>}
          </div>
        </header>

        {stage === 'inspect' && (
          <div className="co-inspect">
            <div className="co-case" aria-hidden="true">{crate}</div>
            <div className="co-contents">
              <span className="co-label">Contains one of the following:</span>
              <div className="co-grid">
                {contents.map((c) => (
                  <div key={c.record.id} className={`co-mini r-${c.rarity}`}>
                    <Avatar seed={c.record.id} size={40} accent="#f0a33a" jersey={playerJersey(c.record.team)} />
                    <b>{c.record.handle}</b>
                    <span>{RARITY_LABEL[c.rarity]}</span>
                    <i className="co-item-bar" aria-hidden="true" />
                  </div>
                ))}
                <div className="co-mini co-any">
                  <span className="co-star" aria-hidden="true">★</span>
                  <b>or any of the {pool.length} players</b>
                </div>
              </div>
              <div className="co-odds">
                {[...RARITIES].reverse().filter((r) => def.odds[r] > 0).map((r) => (
                  <span key={r} className={`r-${r}`}><i />{RARITY_LABEL[r]} <b className="num">{def.odds[r]}%</b></span>
                ))}
              </div>
            </div>
            <div className="co-unlock-row">
              <button className="btn primary co-unlock" onClick={unlock}>
                {caseId === 'daily' ? 'Unlock container' : <>Unlock container · <Coin amount={def.price} /></>}
              </button>
            </div>
          </div>
        )}

        {stage === 'spin' && (
          <div className="co-reel" ref={wrapRef}>
            <div className="co-strip" ref={stripRef}>
              {reel.map((x, i) => <ReelItem key={i} profile={x} />)}
            </div>
            <div className="co-line" aria-hidden="true" />
          </div>
        )}

        {stage === 'reveal' && outcome && p && (
          <div className="co-result" role="status">
            <div className="co-glow" aria-hidden="true" />
            <div className="co-won"><PlayerCard profile={p} /></div>
            <div className="co-name">
              <span className="co-rarity">{RARITY_LABEL[p.rarity]}</span>
              <h1>{p.record.handle} <span className="num">{p.ovr}</span></h1>
              <span className="co-sub">{ROLE_LABEL[p.record.primaryRole]} <OrgTag team={p.record.team} full /></span>
            </div>
            <p className="muted small">
              {outcome.pendingFull
                ? `Your squad is full (5 starters and 3 on the bench). Sell a benched player to sign ${p.record.handle}, or sell ${p.record.handle} straight away.`
                : outcome.duplicate
                ? outcome.refund ? `Already at 5 stars: converted into ${outcome.refund} coins.` : `Duplicate! ${p.record.handle} now has ${outcome.starsNow} star${outcome.starsNow === 1 ? '' : 's'}, raising their ceiling.`
                : `New ${ROLE_LABEL[p.record.primaryRole]} added to your collection. New cards start at 60 sharpness, so train them before they peak.`}
            </p>
            <div className="co-btns">
              {outcome.pendingFull
                ? <button className="btn primary" onClick={onClose}>Choose</button>
                : <>
                  <button className="btn ghost" onClick={() => onView(outcome)}>View card</button>
                  <button className="btn primary" onClick={onClose}>Done</button>
                </>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
