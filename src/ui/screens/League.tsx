import { useMemo, useState } from 'react';
import { ACHIEVEMENTS, aiTeamById, ordinal, teamName, teamTag } from '../../engine/career';
import { CUP_PRIZE, cupName, CUP_START, DIVISIONS, HUMAN_ID, allAiTeams, standings } from '../../engine/season';
import { realTeamMeta } from '../../engine/data/realTeams';
import { REAL_SNAPSHOT_DATE } from '../../engine/data/realPlayers';
import type { PlayerProfile } from '../../engine/types';
import { MAPS, ROLE_LABEL } from '../../engine/types';
import { cardOvr } from '../../engine/ratings';
import { RoleIcon, useGame } from '../common';
import { FormPills, signed, teamForm } from './leagueUtil';
import { Crest } from '../crest';
import '../styles/home.css';

function weekName(w: number): string {
  if (w <= 7) return `Week ${w}`;
  if (w === 8) return 'Semifinals';
  if (w === 9) return 'Final';
  return w === CUP_START ? 'Cup QF' : w === CUP_START + 1 ? 'Cup SF' : 'Cup final';
}

function weekTitle(w: number, division: number): string {
  if (w <= 7) return `League · Week ${w}`;
  if (w <= 9) return `Playoffs · ${w === 8 ? 'Semifinals' : 'Final'}`;
  return `${cupName(division)} · ${w === CUP_START ? 'Quarterfinals' : w === CUP_START + 1 ? 'Semifinals' : 'Final'}`;
}

export function League() {
  const { career: c } = useGame();
  const [teamOpen, setTeamOpen] = useState<string | null>(null);
  const div = DIVISIONS[c.season.division]!;
  const table = standings(c.season);
  const canUp = c.season.division < DIVISIONS.length - 1;
  const canDown = c.season.division > 0;
  const weeks = [...new Set(c.season.fixtures.map((f) => f.week))].sort((a, b) => a - b);
  const defaultWeek = weeks.includes(c.season.week) ? c.season.week : weeks[weeks.length - 1] ?? 1;
  const [week, setWeek] = useState(defaultWeek);
  const shownWeek = weeks.includes(week) ? week : defaultWeek;
  const pos = table.findIndex((r) => r.teamId === HUMAN_ID) + 1;
  const me = table[pos - 1]!;
  const next = c.season.fixtures.filter((f) => !f.result && (f.home === HUMAN_ID || f.away === HUMAN_ID)).sort((a, b) => a.week - b.week)[0];
  const nextOpp = next ? (next.home === HUMAN_ID ? next.away : next.home) : null;
  const unlocked = Object.keys(ACHIEVEMENTS).filter((id) => c.achievements.includes(id)).length;
  const tagOf = (id: string) => (id === HUMAN_ID ? c.teamTag : teamTag(c, id));
  const nameOf = (id: string) => (id === HUMAN_ID ? c.teamName : teamName(c, id));
  const crestOf = (id: string) => <Crest name={nameOf(id)} tag={tagOf(id)} mine={id === HUMAN_ID} size={24} className="lg-crest" />;

  const mapRows = MAPS.map((m) => {
    const played = c.matches.flatMap((x) => x.maps).filter((x) => x.map === m);
    const w = played.filter((x) => x.score[0] > x.score[1]).length;
    const rf = played.reduce((s2, x) => s2 + x.score[0], 0);
    const ra = played.reduce((s2, x) => s2 + x.score[1], 0);
    return { m, n: played.length, w, rf, ra };
  });

  return (
    <>
      <header className="page-head lg-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Season {c.season.number} · {c.season.week > 12 ? 'Finished' : weekTitle(c.season.week, c.season.division)}</span>
          <h1>{div.name}</h1>
        </div>
        <ol className="lg-ladder" aria-label="Divisions, lowest to highest">
          {DIVISIONS.map((d) => (
            <li key={d.id} className={d.id === div.id ? 'on' : d.id < div.id ? 'past' : ''} aria-current={d.id === div.id ? 'step' : undefined}>
              <i aria-hidden="true" /><span>{d.name}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className="span-8 lg-col">
      <section className="panel flush lg-standings lg-o1" aria-label="Standings">
        <div className="panel-head lg-pad"><h2>Standings</h2><span className="small muted">Win = 3 pts · ties split on round difference</span></div>
        <div className="scroll-x">
          <table className="lg-tbl">
            <thead>
              <tr>
                <th className="c-pos">#</th><th className="c-team">Team</th><th>P</th><th>W-L</th><th>RD</th><th>Pts</th><th className="c-form">Form</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => {
                const zone = i < 2 && canUp ? 'up' : i >= table.length - 2 && canDown ? 'down' : '';
                return (
                  <tr key={r.teamId} className={`${r.teamId === HUMAN_ID ? 'me' : ''} ${zone} ${i === 3 ? 'cut' : ''} ${teamOpen === r.teamId ? 'open' : ''}`}>
                    <td className="c-pos num">{i + 1}</td>
                    <td className="c-team"><button className="lg-team" onClick={() => setTeamOpen(teamOpen === r.teamId ? null : r.teamId)} aria-expanded={teamOpen === r.teamId} aria-label={`${nameOf(r.teamId)}: show roster`}>{crestOf(r.teamId)}<span className="lg-tag">{tagOf(r.teamId)}</span><span className="lg-name">{nameOf(r.teamId)}</span></button></td>
                    <td className="num">{r.played}</td>
                    <td className="num">{r.wins}-{r.losses}</td>
                    <td className={`num ${r.roundDiff > 0 ? 'good' : r.roundDiff < 0 ? 'bad' : 'faint'}`}>{signed(r.roundDiff)}</td>
                    <td className="num lg-pts">{r.points}</td>
                    <td className="c-form"><FormPills form={teamForm(c.season, r.teamId)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {teamOpen && <Roster teamId={teamOpen} onClose={() => setTeamOpen(null)} />}
        <div className="lg-legend lg-pad">
          {canUp && <span><i className="up" />Promotion</span>}
          <span><i className="cut" />Playoff line (top 4, Bo3)</span>
          {canDown && <span><i className="down" />Relegation</span>}
        </div>
      </section>

      <section className="panel lg-o3" aria-label="Fixtures">
        <div className="panel-head"><h2>Fixtures</h2><span className="small muted">{weekTitle(shownWeek, c.season.division)}</span></div>
        <div className="lg-weeks" role="group" aria-label="Choose a week">
          {weeks.map((w) => (
            <button key={w} aria-pressed={w === shownWeek} className={`${w === c.season.week ? 'now' : ''} ${w < c.season.week ? 'done' : ''}`} onClick={() => setWeek(w)}>
              {weekName(w)}
            </button>
          ))}
        </div>
        <div className="lg-fixtures">
          {c.season.fixtures.filter((f) => f.week === shownWeek).map((f) => {
            const mine = f.home === HUMAN_ID || f.away === HUMAN_ID;
            const hw = f.result?.winner === f.home;
            const aw = f.result?.winner === f.away;
            return (
              <div key={f.id} className={`lg-fx ${mine ? 'me' : ''} ${f.result ? 'played' : ''}`}>
                <span className={`lg-fx-t home ${hw ? 'win' : ''}`}><span className="lg-fx-name">{nameOf(f.home)}</span><span className="lg-tag">{tagOf(f.home)}</span>{crestOf(f.home)}</span>
                <span className="lg-fx-s num">
                  {f.result ? (f.format === 'bo1' && f.result.maps[0] ? <b>{f.result.maps[0].score[0]}<span className="faint">:</span>{f.result.maps[0].score[1]}</b> : <><b>{f.result.mapScore[0]}<span className="faint">:</span>{f.result.mapScore[1]}</b><small>{f.result.maps.map((m) => `${m.score[0]}-${m.score[1]}`).join(' · ')}</small></>) : <span className="faint">{f.format.toUpperCase()}</span>}
                </span>
                <span className={`lg-fx-t away ${aw ? 'win' : ''}`}>{crestOf(f.away)}<span className="lg-tag">{tagOf(f.away)}</span><span className="lg-fx-name">{nameOf(f.away)}</span></span>
              </div>
            );
          })}
        </div>
      </section>

      </div>

      <div className="span-4 lg-col">
        <section className="panel lg-you lg-o2" aria-label="Your season">
          <div className="panel-head"><span className="label">Your season</span><span className="lg-tag t">{c.teamTag}</span></div>
          <div className="lg-you-kpis">
            <div className="stat"><span className="label">Place</span><span className="v">{ordinal(pos)}</span></div>
            <div className="stat"><span className="label">Points</span><span className="v num">{me.points}</span></div>
            <div className="stat"><span className="label">RD</span><span className={`v num ${me.roundDiff > 0 ? 'good' : me.roundDiff < 0 ? 'bad' : ''}`}>{signed(me.roundDiff)}</span></div>
          </div>
          {next && nextOpp && (
            <div className="lg-next"><span className="label">Next</span><span className="small">{weekName(next.week)} vs <strong>{nameOf(nextOpp)}</strong></span><span className="chip">{next.format.toUpperCase()}</span></div>
          )}
          <dl className="lg-rules">
            <div><dt>1st place</dt><dd className="num">{div.prizes[0]!.toLocaleString('en-US')}</dd></div>
            <div><dt>{cupName(c.season.division)} winner</dt><dd className="num">{Math.round(div.winReward * CUP_PRIZE[0]!).toLocaleString('en-US')}</dd></div>
            <div><dt>Win / loss</dt><dd className="num">{div.winReward} / {Math.round(div.winReward * 0.4)}</dd></div>
          </dl>
          <p className="small faint">Top 4 reach the Bo3 playoffs. Weeks {CUP_START}-{CUP_START + 2} are the {cupName(c.season.division)}: the top teams and you against 4 guests from {canUp ? `the ${DIVISIONS[c.season.division + 1]!.name}` : 'the ESL Pro League'}.{canUp ? ' Top 2 are promoted.' : ''}{canDown ? ' Bottom 2 are relegated.' : ''}</p>
        </section>

        <section className="panel lg-o4" aria-label="Map record">
          <div className="panel-head"><h2>Map record</h2><span className="small muted">all seasons</span></div>
          {c.matches.length === 0 ? <p className="small muted">Play a match to start your map record. Use it in the veto: ban the maps you lose, pick the ones you win.</p> : (
            <div className="lg-maps">
              {mapRows.map((r) => {
                const pct = r.n ? Math.round((r.w / r.n) * 100) : null;
                return (
                  <div key={r.m} className={`lg-map ${r.n ? '' : 'none'}`}>
                    <span className="lg-map-n">{r.m}</span>
                    <span className="num small muted">{r.w}-{r.n - r.w}</span>
                    <div className="lg-map-bar" aria-hidden="true"><i className={pct === null ? '' : pct >= 50 ? 'good' : 'bad'} style={{ width: `${pct ?? 0}%` }} /></div>
                    <span className={`num small ${pct === null ? 'faint' : pct >= 50 ? 'good' : 'bad'}`}>{pct === null ? '—' : `${pct}%`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <Leaders />
        <section className="panel lg-o5" aria-label="Career">
          <h2>Career</h2>
          <div className="lg-you-kpis">
            <div className="stat"><span className="label">Matches</span><span className="v num">{c.totals.matches}</span></div>
            <div className="stat"><span className="label">Win rate</span><span className="v num">{c.totals.matches ? Math.round((c.totals.wins / c.totals.matches) * 100) : 0}<small>%</small></span></div>
            <div className="stat"><span className="label">Titles</span><span className="v num">{c.totals.titles}</span></div>
          </div>
          {c.history.length > 0 ? (
            <table className="tbl">
              <thead><tr><th>Season</th><th style={{ textAlign: 'left' }}>Division</th><th>Place</th><th>W-L</th></tr></thead>
              <tbody>{[...c.history].reverse().map((h) => (
                <tr key={h.season}><td>S{h.season}</td><td className="name" style={{ textAlign: 'left' }}>{DIVISIONS[h.division]!.name}</td><td className={h.movement === 'promoted' ? 'good' : h.movement === 'relegated' ? 'bad' : ''}>{ordinal(h.placement)}</td><td>{h.wins}-{h.losses}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="small faint">Finished seasons will appear here.</p>}
        </section>

        <WorldRanking />

        <section className="panel lg-o6" aria-label="Achievements">
          <div className="panel-head"><h2>Achievements</h2><span className="num small muted">{unlocked}/{Object.keys(ACHIEVEMENTS).length}</span></div>
          <div className="lg-ach-bar" aria-hidden="true"><i style={{ width: `${(unlocked / Object.keys(ACHIEVEMENTS).length) * 100}%` }} /></div>
          <ul className="lg-ach">
            {Object.entries(ACHIEVEMENTS).map(([id, a]) => {
              const got = c.achievements.includes(id);
              return (
                <li key={id} className={got ? 'got' : ''}>
                  <span className="lg-ach-i" aria-hidden="true">{got ? '✓' : ''}</span>
                  <span className="lg-ach-n">{a.name}</span>
                  <span className="lg-ach-d">{a.description}</span>
                  <span className="sr-only">{got ? 'Unlocked' : 'Locked'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}

/**
 * The real-world pecking order of the snapshot's organisations (strongest rosters first), with
 * each org's best player and where it sits in your career right now.
 */
function WorldRanking() {
  const { world, career: c, openPlayer } = useGame();
  const [all, setAll] = useState(false);
  const orgs = useMemo(() => {
    const by = new Map<string, PlayerProfile[]>();
    for (const p of world.profileList) {
      if (!p.record.team) continue;
      const list = by.get(p.record.team) ?? [];
      list.push(p);
      by.set(p.record.team, list);
    }
    return [...by.entries()]
      .map(([key, ps]) => ({ key, meta: realTeamMeta(key), star: [...ps].sort((a, b) => b.ovr - a.ovr)[0]!, mean: ps.reduce((s2, p) => s2 + p.record.rank, 0) / ps.length }))
      .sort((a, b) => a.mean - b.mean);
  }, [world]);
  if (orgs.length < 8) return null;
  const here = new Map(allAiTeams(c.season).map((t) => [t.name, t.guestFrom ? 'Cup guest' : 'Your league']));
  const shown = all ? orgs : orgs.slice(0, 12);
  return (
    <section className="panel lg-o6 lg-world" aria-label="World ranking">
      <div className="panel-head"><h2>World ranking</h2><span className="small muted">Roster strength · Valve standings {REAL_SNAPSHOT_DATE}</span></div>
      <ol className="lg-world-list">
        {shown.map((o, i) => (
          <li key={o.key} className={here.has(o.meta.name) ? 'here' : ''} style={{ ['--org' as string]: o.meta.primary }}>
            <span className="num lg-world-n">{i + 1}</span>
            <Crest name={o.meta.name} tag={o.meta.tag} size={22} />
            <span className="lg-world-name">{o.meta.name}</span>
            <button className="lg-world-star" onClick={() => openPlayer(null, o.star.record.id)} aria-label={`Open ${o.star.record.handle}'s profile`}>{o.star.record.handle}</button>
            {here.has(o.meta.name) && <span className="chip small">{here.get(o.meta.name)}</span>}
          </li>
        ))}
      </ol>
      <button className="btn small ghost" onClick={() => setAll(!all)}>{all ? 'Show top 12' : `Show all ${orgs.length}`}</button>
    </section>
  );
}

/** Roster of one team in the table: tap a player for the full dossier. */
function Roster({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { world, career: c, openPlayer } = useGame();
  const ai = teamId === HUMAN_ID ? null : aiTeamById(c, teamId);
  const rows = ai
    ? ai.playerIds.map((pid, k) => ({ key: pid, cardId: null as string | null, p: world.profiles.get(pid), role: ai.roles[k]!, ovr: world.profiles.get(pid)?.ovr ?? 0 }))
    : c.lineup.map((s) => { const card = c.cards.find((x) => x.cardId === s.cardId)!; const p = world.profiles.get(card.playerId); return { key: s.cardId, cardId: s.cardId as string | null, p, role: s.role, ovr: p ? cardOvr(p, card) : 0 }; });
  return (
    <div className="lg-roster lg-pad" aria-label={`${teamName(c, teamId)} roster`}>
      <div className="row spread"><span className="label">{teamName(c, teamId)} · lineup</span><button className="btn small ghost" onClick={onClose}>Close</button></div>
      <div className="lg-roster-list">
        {rows.filter((r) => r.p).map((r) => (
          <button key={r.key} className="lg-roster-p" onClick={() => openPlayer(r.cardId, r.p!.record.id)} aria-label={`Open ${r.p!.record.handle}'s profile`}>
            <RoleIcon role={r.role} /><b>{r.p!.record.handle}</b><span className="faint small">{ROLE_LABEL[r.role]}</span><span className="num lg-roster-ovr">{r.ovr}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your players ranked by this game's match rating, from the stats stored on each card. */
function Leaders() {
  const { world, career: c, openPlayer } = useGame();
  const rows = c.cards
    .filter((k) => k.stats && k.stats.maps > 0)
    .map((k) => { const st = k.stats!; const r = st.rounds || 1; return { k, p: world.profiles.get(k.playerId)!, maps: st.maps, rating: st.ratingSum / st.maps, kd: st.kills - st.deaths, adr: st.damage / r }; })
    .filter((x) => x.p)
    .sort((a, b) => b.rating - a.rating);
  return (
    <section className="panel lg-o4" aria-label="Squad leaders">
      <div className="panel-head"><h2>Squad leaders</h2><span className="small muted">all matches</span></div>
      {rows.length === 0 ? <p className="small muted">Ratings appear here after your first match.</p> : (
        <table className="tbl lg-leaders">
          <thead><tr><th style={{ textAlign: 'left' }}>Player</th><th>Maps</th><th>K-D</th><th>ADR</th><th>Rtg</th></tr></thead>
          <tbody>
            {rows.slice(0, 7).map((x) => (
              <tr key={x.k.cardId}>
                <td className="name" style={{ textAlign: 'left' }}><button className="link" onClick={() => openPlayer(x.k.cardId)}>{x.p.record.handle}</button></td>
                <td>{x.maps}</td>
                <td className={x.kd > 0 ? 'good' : x.kd < 0 ? 'bad' : ''}>{signed(x.kd)}</td>
                <td>{x.adr.toFixed(0)}</td>
                <td className={x.rating >= 1.1 ? 'good' : x.rating < 0.9 ? 'bad' : ''}>{x.rating.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
