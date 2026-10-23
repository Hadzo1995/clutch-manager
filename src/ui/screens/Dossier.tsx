/**
 * Scouting dossier: the parts of a player profile that come straight from the
 * match engine. Ability vs form vs potential, the combat skills the round
 * simulation actually reads (with what each one changes), strengths and
 * weaknesses against the whole player pool, map results and pair familiarity
 * with teammates. Nothing here is decorative: every number is either stored in
 * the save or computed by the same functions the simulation uses.
 */
import { useMemo } from 'react';
import { cardOvr, effectiveOvr } from '../../engine/ratings';
import { pairFamiliarity } from '../../engine/career';
import { COMBAT_EFFECT, COMBAT_LABEL, COMBAT_SOURCES, combatProfile } from '../../engine/sim/combat';
import { percentile, skillPool, skillRanks } from '../../engine/scouting';
import type { Skill } from '../../engine/scouting';
import { MAPS, ROLE_LABEL } from '../../engine/types';
import type { Attributes, MapName, OwnedCard } from '../../engine/types';
import { useGame } from '../common';
import { Meter } from '../charts';

const SKILL_GROUPS: { name: string; keys: Skill[] }[] = [
  { name: 'Gunplay', keys: ['reflexes', 'crosshair', 'precision', 'sprayControl', 'sniping', 'movement'] },
  { name: 'Reading the round', keys: ['awareness', 'decisions', 'composure', 'consistency'] },
  { name: 'Team play', keys: ['utility', 'communication', 'entrying'] },
];

const pctWord = (pc: number) => (pc >= 90 ? 'elite' : pc >= 70 ? 'strong' : pc >= 40 ? 'average' : pc >= 20 ? 'below average' : 'weak');

export function DossierTab({ playerId, card, attrs }: { playerId: string; card?: OwnedCard; attrs: Attributes }) {
  const { world, career: c, openPlayer } = useGame();
  const p = world.profiles.get(playerId)!;
  const prof = combatProfile(attrs);
  // Each skill against the whole player pool (base attributes), so "strong" means something.
  const pool = useMemo(() => skillPool(world.profileList.map((x) => x.base)), [world]);
  const pctile = (k: Skill, v: number) => percentile(pool[k] ?? [], v);
  const ranked = skillRanks(attrs, pool, p.record.primaryRole === 'awp' || p.record.secondaryRole === 'awp');
  // Best and worst three, ranked against the pool (so even a weak player shows where they are least weak).
  const strengths = ranked.slice(0, 3);
  const weaknesses = ranked.slice(-3).reverse();

  const ovr = card ? cardOvr(p, card) : p.ovr;
  const today = card ? effectiveOvr(p, card) : null;
  const room = p.potential - ovr;

  // Teammates: the other players in your lineup (or squad) when this is one of your cards.
  const inLineup = card ? c.lineup.some((s) => s.cardId === card.cardId) : false;
  const mates = card ? c.lineup.filter((s) => s.cardId !== card.cardId).map((s) => ({ slot: s, card: c.cards.find((x) => x.cardId === s.cardId) })).filter((m) => m.card) : [];
  const pairs = card ? mates.map((m) => ({ ...m, fam: pairFamiliarity(c, card.cardId, m.slot.cardId), prof: world.profiles.get(m.card!.playerId)! })).sort((a, b) => b.fam - a.fam) : [];

  return (
    <>
      <div className="panel inset">
        <div className="panel-head"><h3>Ability, form and max cap</h3></div>
        <div className="dos-afp">
          <div>
            <span className="label">Ability</span>
            <b className="num">{ovr}</b>
            <p className="small faint">{card ? 'Card rating with training. ' : ''}What they can do at full condition.</p>
          </div>
          <div>
            <span className="label">Form</span>
            {card ? <b className={`num ${card.form > 0 ? 'good' : card.form < 0 ? 'bad' : ''}`}>{card.form > 0 ? '+' : ''}{card.form}</b> : <b className="faint">—</b>}
            <p className="small faint">{card ? <>Recent matches, −10 to +10. Plays at <b className="num">{today}</b> today after form, sharpness and fatigue.</> : 'Tracked once the player is in your squad.'}</p>
          </div>
          <div>
            <span className="label">Max cap</span>
            <b className="num">{p.potential}</b>
            <p className="small faint">{room > 0 ? `Room for about ${room} more with training.` : 'At or near the ceiling.'} A game estimate, not a real-world prediction.</p>
          </div>
        </div>
      </div>

      <div className="panel inset">
        <div className="panel-head"><h3>Strengths and weaknesses</h3><span className="small faint">vs all {world.profileList.length} players</span></div>
        <div className="dos-sw">
          <div>
            <span className="label good">Best skills</span>
            <ul>{strengths.map((r) => <li key={r.k}><b>{COMBAT_LABEL[r.k]}</b> <span className="faint small">{pctWord(r.pc)} · p{r.pc}</span><span className="small muted">{COMBAT_EFFECT[r.k]}</span></li>)}</ul>
          </div>
          <div>
            <span className="label bad">Weakest skills</span>
            <ul>{weaknesses.map((r) => <li key={r.k}><b>{COMBAT_LABEL[r.k]}</b> <span className="faint small">{pctWord(r.pc)} · p{r.pc}</span><span className="small muted">{COMBAT_EFFECT[r.k]}</span></li>)}</ul>
          </div>
        </div>
      </div>

      <div className="panel inset">
        <div className="panel-head"><h3>Match engine skills</h3><span className="small faint">at full condition</span></div>
        <p className="small muted">The round simulation reads these, not the raw attributes. Each mixes several attributes; hover or focus a row for the mix and what it does.</p>
        <div className="attr-groups">
          {SKILL_GROUPS.map((g) => (
            <div key={g.name} className="attr-group">
              <div className="attr-group-h"><span className="label">{g.name}</span></div>
              {g.keys.map((k) => {
                const pc = pctile(k, prof[k]);
                return (
                  <div key={k} className="dos-skill" tabIndex={0} data-tip={`${COMBAT_EFFECT[k]} From: ${COMBAT_SOURCES[k]}.`}>
                    <Meter value={prof[k]} tone="auto" label={COMBAT_LABEL[k]} display={<>{prof[k]} <small className="faint">p{pc}</small></>} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {card && (
        <div className="panel inset">
          <div className="panel-head"><h3>Synergy with teammates</h3>{!inLineup && <span className="small faint">not in the lineup</span>}</div>
          {pairs.length ? (
            <>
              <div className="dos-pairs">
                {pairs.map((m) => (
                  <button key={m.slot.cardId} className="dos-pair" onClick={() => openPlayer(m.slot.cardId)} aria-label={`Open ${m.prof.record.handle}'s profile`}>
                    <span className="dos-pair-n"><b>{m.prof.record.handle}</b> <span className="faint small">{ROLE_LABEL[m.slot.role]}</span></span>
                    <Meter value={m.fam} tone={m.fam >= 70 ? 'good' : m.fam >= 40 ? 'ct' : 'warn'} size="sm" display={<span className="num">{Math.round(m.fam)}</span>} />
                  </button>
                ))}
              </div>
              <p className="small faint">Pair familiarity, 0 to 100. In a round it shortens the time before this pair hears each other's callouts, widens how far one will go to trade the other, and speeds up spotting an enemy the other is already fighting. It grows with bootcamps, scrims, reviews and maps played together.</p>
            </>
          ) : <p className="small faint">Put this player in the lineup to build and see pair familiarity with teammates.</p>}
        </div>
      )}
    </>
  );
}

/** Your results by map with this player, from the card's match log. */
export function MapResults({ card }: { card: OwnedCard }) {
  const log = card.log ?? [];
  const rows = MAPS.map((m) => {
    const games = log.filter((l) => l.map === m);
    const w = games.filter((g) => g.won).length;
    const rating = games.length ? games.reduce((s, g) => s + g.rating, 0) / games.length : null;
    return { m, n: games.length, w, l: games.length - w, rating };
  }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || (b.rating ?? 0) - (a.rating ?? 0));
  if (!rows.length) return null;
  return (
    <div className="panel inset">
      <div className="panel-head"><h3>By map</h3><span className="small faint">last {log.length} maps logged</span></div>
      <table className="tbl ps-log">
        <thead><tr><th>Map</th><th>Maps</th><th>W-L</th><th>Avg rating</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m as MapName}>
              <td className="name">{r.m}</td>
              <td>{r.n}</td>
              <td>{r.w}-{r.l}</td>
              <td className={r.rating! >= 1.1 ? 'good' : r.rating! < 0.9 ? 'bad' : ''}>{r.rating!.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
