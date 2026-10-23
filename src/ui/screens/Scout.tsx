/**
 * Scouting database and transfer market: every player in the dataset, with
 * search, filters, sorting, a shortlist and side-by-side comparison.
 * Desktop shows a sortable data table; phones get compact rows with the same data.
 */
import { Avatar } from '../avatar/Avatar';
import { playerJersey } from '../../engine/data/realTeams';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { demandOf, playerStatus, toggleShortlist } from '../../engine/career';
import { marketValue } from '../../engine/economy';
import { allAiTeams } from '../../engine/season';
import { ROLES, ROLE_LABEL } from '../../engine/types';
import type { PlayerProfile, Role } from '../../engine/types';
import { Coin, PlayerCard, RoleIcon, useGame, CountryTag, OrgTag } from '../common';
import { ratingTone } from '../charts';
import { CompareSheet } from './Compare';

type Owner = 'all' | 'free' | 'ai' | 'shortlist' | 'you';
type SortKey = 'ovr' | 'potential' | 'value' | 'rating' | 'adr' | 'opening' | 'clutch' | 'awp' | 'age';
type Dir = 'asc' | 'desc';

const SORT_LABEL: Record<SortKey, string> = {
  ovr: 'Overall', potential: 'Potential', value: 'Value', rating: 'Rating (source)', adr: 'ADR', opening: 'Opening duels won', clutch: 'Clutch win rate', awp: 'AWP kill share', age: 'Age',
};
/** The direction a column sorts in on first click: "best first" for skills, cheapest/youngest first otherwise. */
const DEFAULT_DIR: Record<SortKey, Dir> = { ovr: 'desc', potential: 'desc', value: 'asc', rating: 'desc', adr: 'desc', opening: 'desc', clutch: 'desc', awp: 'desc', age: 'asc' };
const OWNER_LABEL: Record<Owner, string> = { all: 'Everyone', free: 'Free agents', ai: 'At clubs', shortlist: 'Shortlist', you: 'Your squad' };

const PAGE = 25;
const kfmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}`);

export function Scout() {
  const { world, career: c, update, openPlayer } = useGame();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [owner, setOwner] = useState<Owner>('all');
  const [sort, setSort] = useState<SortKey>('ovr');
  const [dir, setDir] = useState<Dir>('desc');
  const [maxValue, setMaxValue] = useState<number>(0);
  const [minOvr, setMinOvr] = useState<number>(0);
  const [team, setTeam] = useState<string>('all');
  const [shown, setShown] = useState(PAGE);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const raw = (p: PlayerProfile, value: number): number | null => {
      const s = p.record.stats;
      switch (sort) {
        case 'ovr': return p.ovr;
        case 'potential': return p.potential;
        case 'value': return value;
        case 'rating': return s.rating;
        case 'adr': return s.adr ?? null;
        case 'opening': return s.openingSuccess ?? null;
        case 'clutch': return s.clutchWinRate ?? null;
        case 'awp': return s.awpKillShare ?? null;
        case 'age': return p.record.age;
      }
    };
    const sign = dir === 'asc' ? 1 : -1;
    return world.profileList
      .map((p) => ({ p, st: playerStatus(c, p.record.id), value: marketValue(p) }))
      .filter(({ p, st, value }) => {
        if (needle && !p.record.handle.toLowerCase().includes(needle) && !p.record.country.toLowerCase().includes(needle)) return false;
        if (role !== 'all' && p.record.primaryRole !== role) return false;
        if (owner === 'free' && st.owner !== 'free') return false;
        if (owner === 'ai' && st.owner !== 'ai') return false;
        if (owner === 'you' && st.owner !== 'you') return false;
        if (owner === 'shortlist' && !c.shortlist.includes(p.record.id)) return false;
        if (team !== 'all' && st.teamId !== team) return false;
        if (maxValue && value > maxValue) return false;
        if (minOvr && p.ovr < minOvr) return false;
        return true;
      })
      .map((r) => ({ ...r, key: raw(r.p, r.value) }))
      .sort((a, b) => {
        if (a.key === null && b.key !== null) return 1; // "no data" always last
        if (b.key === null && a.key !== null) return -1;
        return ((a.key ?? 0) - (b.key ?? 0)) * sign || a.p.record.rank - b.p.record.rank;
      });
  }, [world, c, q, role, owner, sort, dir, maxValue, minOvr, team]);

  // A hint for the weakest lineup slot, so the market answers "who do I need?".
  const weakest = useMemo(() => {
    let worst: { role: Role; ovr: number } | null = null;
    for (const s of c.lineup) {
      const card = c.cards.find((x) => x.cardId === s.cardId);
      const p = card ? world.profiles.get(card.playerId) : undefined;
      if (!p) continue;
      if (!worst || p.ovr < worst.ovr) worst = { role: s.role, ovr: p.ovr };
    }
    return worst;
  }, [c, world]);

  // Featured picks: a quick, visual way into the database before the table.
  const picks = useMemo(() => {
    const pool = world.profileList.filter((p) => playerStatus(c, p.record.id).owner !== 'you');
    // Each pick skips players already featured, so the strip never shows the same card twice.
    const used = new Set<string>();
    const best = (f: (p: PlayerProfile) => number, list = pool) => {
      const p = list.filter((x) => !used.has(x.record.id)).sort((a, b) => f(b) - f(a))[0];
      if (p) used.add(p.record.id);
      return p;
    };
    const free = pool.filter((p) => playerStatus(c, p.record.id).owner === 'free');
    const out: { label: string; note: string; p?: PlayerProfile }[] = [];
    if (weakest) out.push({ label: `Upgrade at ${ROLE_LABEL[weakest.role]}`, note: `Your starter is ${weakest.ovr}`, p: best((p) => p.ovr, pool.filter((p) => p.record.primaryRole === weakest.role)) });
    out.push(
      { label: 'Best free agent', note: 'Highest overall without a club', p: best((p) => p.ovr, free) },
      { label: 'Wonderkid', note: 'Biggest growth, 21 or younger', p: best((p) => p.potential - p.ovr + p.potential / 100, pool.filter((p) => p.record.age <= 21)) },
      { label: 'Bargain', note: 'Most overall per coin', p: best((p) => p.ovr / Math.max(1, marketValue(p)), pool.filter((p) => p.ovr >= 70)) },
    );
    return out.filter((x) => x.p);
  }, [world, c, weakest]);

  const toggleCompare = (id: string) => setCompare((x) => x.includes(id) ? x.filter((y) => y !== id) : [...x.slice(-1), id]);
  const sortBy = (k: SortKey) => { if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir(DEFAULT_DIR[k]); } };
  const reset = () => { setQ(''); setRole('all'); setOwner('all'); setTeam('all'); setMinOvr(0); setMaxValue(0); setShown(PAGE); };
  const filtered = q || role !== 'all' || owner !== 'all' || team !== 'all' || minOvr || maxValue;
  const page = rows.slice(0, shown);

  const th = (k: SortKey, children: ReactNode, className = '', title?: string) => (
    <th key={k} className={`sortable ${className}${sort === k ? ' on' : ''}`} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => sortBy(k)} title={title ?? `Sort by ${SORT_LABEL[k]}`}>
        {children}<span className="sort-ind" aria-hidden="true">{sort === k ? (dir === 'asc' ? '▲' : '▼') : '▲'}</span>
      </button>
    </th>
  );
  const interestOf = (id: string, own: string) => (own === 'you' ? null : demandOf(world, c, id).interest);
  const starBtn = (id: string, handle: string) => {
    const listed = c.shortlist.includes(id);
    return <button className={`icon-btn star${listed ? ' on' : ''}`} aria-pressed={listed} aria-label={listed ? `Remove ${handle} from shortlist` : `Shortlist ${handle}`} onClick={(e) => { e.stopPropagation(); update(toggleShortlist(c, id)); }}>{listed ? '★' : '☆'}</button>;
  };
  const cmpBtn = (id: string, handle: string) => {
    const on = compare.includes(id);
    return (
      <button className={`icon-btn cmp${on ? ' on' : ''}`} aria-pressed={on} aria-label={`Compare ${handle}`} title={on ? 'Remove from comparison' : 'Add to comparison'} onClick={(e) => { e.stopPropagation(); toggleCompare(id); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
      </button>
    );
  };
  const interestDot = (v: ReturnType<typeof interestOf>) => v === null ? null : (
    <span className={`int-dot ${v}`} data-tip={v === 'none' ? 'Not interested' : `${v[0]!.toUpperCase()}${v.slice(1)} interest`} tabIndex={0} aria-label={v === 'none' ? 'Not interested' : `${v} interest`} />
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Scouting</h1>
          <div className="sub">All <span className="num">{world.profileList.length}</span> players. Values, wages and interest are game values.</div>
        </div>
        <span className="ph-coins"><Coin amount={c.coins} /></span>
      </header>

      {!filtered && (
        <section className="sc-picks" aria-label="Scout picks">
          {picks.map((x) => (
            <div key={x.label} className="sc-pick">
              <span className="label">{x.label}</span>
              <PlayerCard profile={x.p!} onClick={() => openPlayer(null, x.p!.record.id)} />
              <span className="small faint">{x.note}</span>
            </div>
          ))}
        </section>
      )}

      <section className="panel scout-filters" aria-label="Filters">
        <div className="sf-top">
          <label className="search" htmlFor="sc-q">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" /></svg>
            <span className="sr-only">Search</span>
            <input id="sc-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search name or country code" />
          </label>
          <div className="sf-selects">
            <select className="inline" id="sc-owner" aria-label="Status" value={owner} onChange={(e) => { setOwner(e.target.value as Owner); setShown(PAGE); }}>
              {(Object.keys(OWNER_LABEL) as Owner[]).map((o) => <option key={o} value={o}>{o === 'shortlist' ? `★ Shortlist (${c.shortlist.length})` : OWNER_LABEL[o]}</option>)}
            </select>
            <select className="inline" id="sc-team" aria-label="Club" value={team} onChange={(e) => { setTeam(e.target.value); setShown(PAGE); }}>
              <option value="all">Any club</option>
              {allAiTeams(c.season).map((t) => <option key={t.id} value={t.id}>{t.name}{t.guestFrom ? ' (cup guest)' : ''}</option>)}
            </select>
            <select className="inline" id="sc-ovr" aria-label="Minimum overall" value={minOvr} onChange={(e) => { setMinOvr(Number(e.target.value)); setShown(PAGE); }}>
              {[0, 65, 70, 75, 80, 85, 90].map((v) => <option key={v} value={v}>{v ? `OVR ${v}+` : 'Any OVR'}</option>)}
            </select>
            <select className="inline" id="sc-price" aria-label="Maximum value" value={maxValue} onChange={(e) => { setMaxValue(Number(e.target.value)); setShown(PAGE); }}>
              <option value={0}>Any value</option>
              <option value={Math.max(0, c.coins)}>Affordable (≤{Math.max(0, c.coins)})</option>
              {[1000, 2500, 5000, 10000].map((v) => <option key={v} value={v}>Up to {kfmt(v)}</option>)}
            </select>
          </div>
        </div>
        <div className="sf-chips">
          <div className="chipset" role="group" aria-label="Role">
            <button aria-pressed={role === 'all'} onClick={() => { setRole('all'); setShown(PAGE); }}>All roles</button>
            {ROLES.map((r) => <button key={r} aria-pressed={role === r} onClick={() => { setRole(r); setShown(PAGE); }}><RoleIcon role={r} />{ROLE_LABEL[r]}</button>)}
          </div>
        </div>
        <div className="sf-foot">
          {weakest && (
            <button className="hint-btn" onClick={() => { setRole(weakest.role); setOwner('all'); setSort('ovr'); setDir('desc'); setMinOvr(weakest.ovr + 1); setShown(PAGE); }}>
              <RoleIcon role={weakest.role} /> Upgrade your {ROLE_LABEL[weakest.role]} <span className="faint">(now {weakest.ovr})</span> →
            </button>
          )}
          {filtered ? <button className="btn small ghost" onClick={reset}>Reset filters</button> : null}
        </div>
      </section>

      <section className="panel flush scout-results" aria-label="Players">
        <div className="sr-head">
          <h2><span className="num">{rows.length}</span> players</h2>
          <span className="int-legend small faint" aria-hidden="true">Interest <i className="int-dot high" /> keen <i className="int-dot low" /> lukewarm <i className="int-dot none" /> no</span>
          <div className="sr-sort">
            <label className="sr-only" htmlFor="sc-sort">Sort by</label>
            <select className="inline" id="sc-sort" value={sort} onChange={(e) => { const k = e.target.value as SortKey; setSort(k); setDir(DEFAULT_DIR[k]); }}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
            <button className="icon-btn" onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))} aria-label={dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'}>{dir === 'asc' ? '▲' : '▼'}</button>
          </div>
        </div>
        {rows.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <p className="muted small">{owner === 'shortlist' ? 'Your shortlist is empty. Tap ☆ on any player to keep track of them.' : 'No players match these filters.'}</p>
            {filtered ? <button className="btn small ghost" onClick={reset}>Reset filters</button> : null}
          </div>
        )}

        {rows.length > 0 && (
          <table className="scout-table">
            <thead>
              <tr>
                <th className="c-star"><span className="sr-only">Shortlist</span></th>
                <th className="c-player">Player</th>
                <th className="c-role">Role</th>
                {th('age', 'Age', 'c-n')}
                <th className="c-club">Club</th>
                {th('ovr', 'OVR', 'c-n')}
                {th('potential', 'POT', 'c-n')}
                {th('rating', 'Rtg', 'c-n', 'Source rating')}
                {th('adr', 'ADR', 'c-n')}
                {th('opening', 'Open%', 'c-n', 'Opening duels won %')}
                {th('clutch', 'Clu%', 'c-n', 'Clutch win rate %')}
                {th('awp', 'AWP%', 'c-n', 'AWP kill share %')}
                {th('value', 'Value', 'c-n')}
                <th className="c-act"><span className="sr-only">Compare</span></th>
              </tr>
            </thead>
            <tbody>
              {page.map(({ p, st, value }) => {
                const s = p.record.stats;
                const id = p.record.id;
                const inCmp = compare.includes(id);
                return (
                  <tr key={id} className={`${st.owner === 'you' ? 'mine' : ''}${inCmp ? ' cmp-on' : ''}`} onClick={() => openPlayer(null, id)}>
                    <td className="c-star">{starBtn(id, p.record.handle)}</td>
                    <td className="c-player">
                      <button className="pl-btn" onClick={(e) => { e.stopPropagation(); openPlayer(null, id); }}>
                        <Avatar seed={id} size={32} accent={st.owner === 'you' ? '#f0a33a' : '#5aa9e6'} jersey={st.owner === 'you' ? undefined : playerJersey(p.record.team)} className={`ava-ring ${p.rarity}`} />
                        <span className="pl-id"><strong>{p.record.handle}</strong><span className="faint num"><CountryTag cc={p.record.country} /> <OrgTag team={p.record.team} /> #{p.record.rank}</span></span>
                      </button>
                    </td>
                    <td className="c-role"><span className="role-tag"><RoleIcon role={p.record.primaryRole} />{ROLE_LABEL[p.record.primaryRole]}</span></td>
                    <td className="c-n">{p.record.age}</td>
                    <td className="c-club">{st.owner === 'you' ? <span className="t-col">Yours</span> : st.owner === 'ai' ? <span>{st.teamTag}</span> : <span className="faint">Free</span>} {interestDot(interestOf(id, st.owner))}</td>
                    <td className="c-n"><span className={`ovr-cell tone-${ratingTone(p.ovr)}`}>{p.ovr}</span></td>
                    <td className="c-n pot">{p.potential}{p.potential > p.ovr && <small className="good">+{p.potential - p.ovr}</small>}</td>
                    <td className={`c-n ${s.rating >= 1.1 ? 'good' : s.rating < 0.95 ? 'faint' : ''}`}>{s.rating.toFixed(2)}</td>
                    <td className="c-n">{s.adr === null || s.adr === undefined ? '—' : s.adr.toFixed(0)}</td>
                    <td className="c-n">{pct(s.openingSuccess)}</td>
                    <td className="c-n">{pct(s.clutchWinRate)}</td>
                    <td className="c-n">{pct(s.awpKillShare)}</td>
                    <td className={`c-n ${value > c.coins ? 'faint' : ''}`}>{kfmt(value)}</td>
                    <td className="c-act">{cmpBtn(id, p.record.handle)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="scout-list">
          {page.map(({ p, st, value }) => {
            const id = p.record.id;
            const interest = interestOf(id, st.owner);
            const sortedStat = sort === 'rating' ? p.record.stats.rating.toFixed(2) : sort === 'adr' ? (p.record.stats.adr?.toFixed(0) ?? '—') : sort === 'opening' ? pct(p.record.stats.openingSuccess) : sort === 'clutch' ? pct(p.record.stats.clutchWinRate) : sort === 'awp' ? pct(p.record.stats.awpKillShare) : null;
            return (
              <div key={id} className={`scout-row${compare.includes(id) ? ' cmp-on' : ''}${st.owner === 'you' ? ' mine' : ''}`}>
                <button className="scout-main" onClick={() => openPlayer(null, id)}>
                  <Avatar seed={id} size={38} accent={st.owner === 'you' ? '#f0a33a' : '#5aa9e6'} jersey={st.owner === 'you' ? undefined : playerJersey(p.record.team)} className={`scout-ava ava-ring ${p.rarity}`} />
                  <span className="who">
                    <strong>{p.record.handle} <span className="faint num rk">#{p.record.rank}</span></strong>
                    <span className="small muted"><RoleIcon role={p.record.primaryRole} /> {ROLE_LABEL[p.record.primaryRole]} · {p.record.age}y · <span className={`num ${value > c.coins ? 'faint' : ''}`}>{kfmt(value)}</span></span>
                    <span className="who-club">
                      <span className={st.owner === 'you' ? 't-col' : st.owner === 'ai' ? '' : 'faint'}>{st.owner === 'you' ? 'Your squad' : st.owner === 'ai' ? st.teamTag : 'Free agent'}</span>
                      {interest && <span className={`int-txt ${interest}`}><i className={`int-dot ${interest}`} aria-hidden="true" />{interest === 'none' ? 'not interested' : interest === 'high' ? 'keen to talk' : `${interest} interest`}</span>}
                    </span>
                  </span>
                  <span className="nums num">
                    <span className="nv"><span className={`ovr-cell tone-${ratingTone(p.ovr)}`}>{p.ovr}</span><small className="faint" title={sortedStat ? SORT_LABEL[sort] : 'Potential'}>{sortedStat ?? `pot ${p.potential}`}</small></span>
                  </span>
                </button>
                <div className="scout-actions">
                  {starBtn(id, p.record.handle)}
                  {cmpBtn(id, p.record.handle)}
                </div>
              </div>
            );
          })}
        </div>
        {shown < rows.length && (
          <div className="sr-more">
            <span className="small faint">Showing <span className="num">{Math.min(shown, rows.length)}</span> of <span className="num">{rows.length}</span></span>
            <button className="btn small ghost" onClick={() => setShown((x) => x + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>
          </div>
        )}
      </section>

      {compare.length > 0 && (
        <div className="compare-tray" role="region" aria-label="Comparison">
          <div className="ct-players">
            {[0, 1].map((i) => {
              const id = compare[i];
              const p = id ? world.profiles.get(id) : undefined;
              return p ? (
                <span key={i} className={`ct-p ${i ? 'b' : 'a'}`}>
                  <Avatar seed={p.record.id} size={28} />
                  <strong>{p.record.handle}</strong>
                  <button className="ct-x" aria-label={`Remove ${p.record.handle}`} onClick={() => toggleCompare(p.record.id)}>×</button>
                </span>
              ) : <span key={i} className="ct-p empty">Pick another player</span>;
            }).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, <span key="vs" className="ct-vs">vs</span>, el] : [el]), [])}
          </div>
          <div className="row">
            <button className="btn small ghost" onClick={() => setCompare([])}>Clear</button>
            <button className="btn small primary" disabled={compare.length < 2} onClick={() => setComparing(true)}>Compare</button>
          </div>
        </div>
      )}
      {comparing && compare.length === 2 && <CompareSheet ids={[compare[0]!, compare[1]!]} onClose={() => setComparing(false)} />}
    </>
  );
}
