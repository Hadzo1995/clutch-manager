/**
 * Small, dependency-free SVG/CSS charts shared by the squad, profile, scouting and compare screens.
 * One visual language: amber (--t) for "this player now", ink outlines for baselines, status colours
 * only where a value is judged (good / ok / weak). Numbers always use the data font.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './styles/team.css';

// ---------- Rating scale ----------

/** Shared judgement for 0..100 ratings so every chart colours a 78 the same way. */
export function ratingTone(v: number): 'elite' | 'strong' | 'ok' | 'weak' {
  if (v >= 80) return 'elite';
  if (v >= 68) return 'strong';
  if (v >= 55) return 'ok';
  return 'weak';
}
export const TONE_VAR: Record<ReturnType<typeof ratingTone>, string> = {
  elite: 'var(--good)', strong: 'var(--ct)', ok: 'var(--warn)', weak: 'var(--bad)',
};

const clampPct = (v: number, max: number) => Math.max(0, Math.min(100, (v / max) * 100));

// ---------- Meter: a labelled horizontal bar ----------

/**
 * Horizontal meter. `ghost` draws a faint extension up to a second value (potential, cap);
 * `base` splits the bar into base + gain (training growth shown in green).
 */
export function Meter({ value, max = 100, tone, ghost, base, label, display, size = 'md', title }: {
  value: number; max?: number; tone?: 'auto' | 't' | 'ct' | 'good' | 'bad' | 'warn' | 'ink'; ghost?: number; base?: number;
  label?: ReactNode; display?: ReactNode; size?: 'sm' | 'md'; title?: string;
}) {
  const t = tone === 'auto' || tone === undefined ? ratingTone(value) : tone;
  const fillPct = clampPct(value, max);
  const basePct = base !== undefined && base < value ? clampPct(base, max) : null;
  const bar = (
    <span className={`mtr mtr-${size} tone-${t}`} role="img" aria-label={`${typeof label === 'string' ? label + ' ' : ''}${Math.round(value)} of ${max}`}>
      {ghost !== undefined && ghost > value && <i className="mtr-ghost" style={{ width: `${clampPct(ghost, max)}%` }} />}
      <i className="mtr-fill" style={{ width: `${basePct ?? fillPct}%` }} />
      {basePct !== null && <i className="mtr-gain" style={{ left: `${basePct}%`, width: `${fillPct - basePct}%` }} />}
    </span>
  );
  if (label === undefined && display === undefined) return bar;
  return (
    <div className={`mtr-row mtr-row-${size}`} title={title}>
      {label !== undefined && <span className="mtr-label">{label}</span>}
      {bar}
      <span className={`mtr-val num tone-${t}`}>{display ?? Math.round(value)}</span>
    </div>
  );
}

// ---------- OVR vs potential ----------

/** Current rating against potential on a 40..100 track: filled = now, hatched = room to grow. */
export function RatingBar({ ovr, potential, today }: { ovr: number; potential: number; today?: number }) {
  const lo = 40, hi = 100;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div className="rbar" role="img" aria-label={`Overall ${ovr}, max cap ${potential}${today !== undefined ? `, plays at ${today} today` : ''}`}>
      <div className="rbar-track">
        <i className="rbar-pot" style={{ left: `${pos(ovr)}%`, width: `${Math.max(0, pos(potential) - pos(ovr))}%` }} />
        <i className="rbar-now" style={{ width: `${pos(ovr)}%` }} />
        {today !== undefined && today !== ovr && <i className="rbar-today" style={{ left: `${pos(today)}%` }} />}
      </div>
      <div className="rbar-scale num" aria-hidden="true"><span>{lo}</span><span>70</span><span>{hi}</span></div>
    </div>
  );
}

// ---------- Radar ----------

export interface RadarAxis { key: string; label: string; value: number; base?: number }

/**
 * Spider chart on a fixed 30..100 scale so shapes are comparable between players.
 * `base` (optional per axis) is drawn as a dashed outline beneath the filled "now" shape.
 */
export function AttributeRadar({ axes, size = 280, showValues = true, tone = 't', label = 'Attribute shape' }: {
  axes: RadarAxis[]; size?: number; showValues?: boolean; tone?: 't' | 'ct'; label?: string;
}) {
  const N = axes.length;
  const R = 100;
  const scale = (v: number) => Math.max(0.04, Math.min(1, (v - 30) / 70)) * R;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
    return [Math.cos(a) * scale(v), Math.sin(a) * scale(v)] as const;
  };
  const poly = (get: (a: RadarAxis) => number) => axes.map((a, i) => pt(i, get(a)).map((n) => n.toFixed(1)).join(',')).join(' ');
  const hasBase = axes.some((a) => a.base !== undefined && Math.round(a.base) !== Math.round(a.value));
  const pad = showValues ? 58 : 34;
  const col = tone === 't' ? 'var(--t)' : 'var(--ct)';
  return (
    <svg className="radar2" viewBox={`${-R - pad} ${-R - 22} ${(R + pad) * 2} ${(R + 22) * 2 + 4}`} style={{ maxWidth: size }} role="img" aria-label={`${label}: ${axes.map((a) => `${a.label} ${Math.round(a.value)}`).join(', ')}`}>
      {[50, 70, 85, 100].map((ring) => (
        <polygon key={ring} points={axes.map((_, i) => pt(i, ring).join(',')).join(' ')} className={`rd-ring${ring === 100 ? ' outer' : ''}`} />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1="0" y1="0" x2={x} y2={y} className="rd-spoke" />; })}
      <polygon points={poly((a) => a.value)} fill={col} fillOpacity="0.22" stroke={col} strokeWidth="2" strokeLinejoin="round" className="rd-shape" />
      {hasBase && <polygon points={poly((a) => a.base ?? a.value)} fill="none" stroke="var(--ink-2)" strokeWidth="1.2" strokeDasharray="4 3" />}
      {axes.map((a, i) => { const [x, y] = pt(i, a.value); return <circle key={a.key} cx={x} cy={y} r="2.6" fill={col} />; })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 100);
        const lx = x * 1.13, ly = y * 1.1;
        const anchor = Math.abs(lx) < 8 ? 'middle' : lx > 0 ? 'start' : 'end';
        return (
          <text key={a.key} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="rd-label">
            {a.label}
            {showValues && <tspan dx="5" className="rd-val" fill={TONE_VAR[ratingTone(a.value)]}>{Math.round(a.value)}</tspan>}
          </text>
        );
      })}
    </svg>
  );
}

// ---------- Trend / sparkline ----------

/**
 * Line chart for a short history (ratings by map, OVR by week). Draws the first/last values,
 * the min/max range on the right edge and an optional reference line (e.g. a 1.00 rating).
 */
/** Width of an element, kept in sync with layout so SVG text renders at its real pixel size. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { const v = Math.round(el.getBoundingClientRect().width); if (v > 0) setW(v); };
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function TrendChart({ values, label, digits = 0, mid, midLabel, height = 96, tone = 't', summary = 'delta' }: {
  values: number[]; label: string; digits?: number; mid?: number; midLabel?: string; height?: number; tone?: 't' | 'ct';
  /** Headline beside the label: change since the first point (a progression), or the average (independent samples). */
  summary?: 'delta' | 'avg';
}) {
  const [ref, W] = useWidth<HTMLElement>(320);
  if (values.length < 2) return null;
  const H = height, padL = 6, padR = 40, padT = 10, padB = 10;
  let min = Math.min(...values, mid ?? Infinity);
  let max = Math.max(...values, mid ?? -Infinity);
  if (max - min < (digits ? 0.2 : 4)) { const c = (max + min) / 2; const h = digits ? 0.1 : 2; min = c - h; max = c + h; }
  const x = (i: number) => padL + (i / (values.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0)},${H - padB} ${line} ${x(values.length - 1)},${H - padB}`;
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const delta = last - first;
  const col = tone === 't' ? 'var(--t)' : 'var(--ct)';
  const id = `tg-${label.replace(/\W/g, '')}`;
  const near = (a: number, b: number) => Math.abs(y(a) - y(b)) < 12;
  const showMid = mid !== undefined && !near(mid, max) && !near(mid, min);
  return (
    <figure className="trend" ref={ref}>
      <figcaption className="trend-head">
        <span className="label">{label}</span>
        {midLabel && mid !== undefined && <span className="trend-key small faint"><i aria-hidden="true" /> {midLabel}</span>}
        {summary === 'avg'
          ? <span className="num trend-now"><small className="faint">avg </small>{(values.reduce((s, v) => s + v, 0) / values.length).toFixed(digits)}</span>
          : <span className="num trend-now">{last.toFixed(digits)}<span className={`trend-d ${delta > 0 ? 'good' : delta < 0 ? 'bad' : 'faint'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(digits)}</span></span>}
      </figcaption>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={`${label}: from ${first.toFixed(digits)} to ${last.toFixed(digits)} over ${values.length} points`}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={col} stopOpacity="0.26" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padL} x2={W - padR} y1={y(max)} y2={y(max)} className="trend-grid" />
        <line x1={padL} x2={W - padR} y1={y(min)} y2={y(min)} className="trend-grid" />
        <text x={W - padR + 8} y={y(max)} className="trend-ax" dominantBaseline="middle">{max.toFixed(digits)}</text>
        <text x={W - padR + 8} y={y(min)} className="trend-ax" dominantBaseline="middle">{min.toFixed(digits)}</text>
        {mid !== undefined && <line x1={padL} x2={W - padR} y1={y(mid)} y2={y(mid)} className="trend-mid" />}
        {showMid && <text x={W - padR + 8} y={y(mid!)} className="trend-ax" dominantBaseline="middle">{mid!.toFixed(digits)}</text>}
        <polygon points={area} fill={`url(#${id})`} />
        <polyline points={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 4 : 2.5} fill={i === values.length - 1 ? col : 'var(--panel)'} stroke={col} strokeWidth="1.5"><title>{v.toFixed(digits)}</title></circle>)}
      </svg>
    </figure>
  );
}

/** Tiny inline trend, no axes: for table cells and cards. */
export function Sparkline({ values, width = 64, height = 20, tone = 't', label }: { values: number[]; width?: number; height?: number; tone?: 't' | 'ct' | 'good' | 'bad'; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const col = `var(--${tone})`;
  return (
    <svg className="spark2" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `Trend ${values[0]} to ${values[values.length - 1]}`}>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Form ----------

/** Recent results, oldest left, newest right. Each pill shows W/L, tinted by the player's rating. */
export function FormPills({ games, max = 10 }: { games: { won: boolean; rating: number; title: string }[]; max?: number }) {
  const shown = games.slice(-max);
  return (
    <div className="form-pills" role="list" aria-label="Recent form, oldest first">
      {shown.map((g, i) => (
        <span key={i} role="listitem" className={`fp ${g.won ? 'w' : 'l'} ${g.rating >= 1.15 ? 'hot' : g.rating < 0.85 ? 'cold' : ''}`} data-tip={g.title} tabIndex={0}>
          <b>{g.won ? 'W' : 'L'}</b><span className="num">{g.rating.toFixed(2)}</span>
        </span>
      ))}
    </div>
  );
}

// ---------- Comparison ----------

/**
 * Butterfly row: value A grows left from the centre, value B grows right. The better side is lit.
 * `max` fixes the scale (attributes use 100); otherwise the larger value fills the half.
 */
export function DuelBar({ label, a, b, max, lowerBetter = false, format }: {
  label: string; a: number | null; b: number | null; max?: number; lowerBetter?: boolean; format?: (n: number) => string;
}) {
  const top = max ?? Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0), 1e-9);
  const w = (v: number | null) => (v === null ? 0 : Math.max(2, Math.min(100, (Math.abs(v) / top) * 100)));
  const better = a === null || b === null || a === b ? 0 : (lowerBetter ? a < b : a > b) ? 1 : 2;
  const f = (v: number | null) => (v === null ? '—' : format ? format(v) : String(Math.round(v * 10) / 10));
  return (
    <div className="duel" role="row">
      <span className={`duel-v a num ${better === 1 ? 'win' : ''}`} role="cell">{f(a)}</span>
      <span className="duel-l" role="rowheader">{label}{lowerBetter && <span className="faint" title="Lower is better"> ↓</span>}</span>
      <span className={`duel-v b num ${better === 2 ? 'win' : ''}`} role="cell">{f(b)}</span>
      <span className={`duel-bar a ${better === 1 ? 'win' : ''}`} aria-hidden="true"><i style={{ width: `${w(a)}%` }} /></span>
      <span className={`duel-bar b ${better === 2 ? 'win' : ''}`} aria-hidden="true"><i style={{ width: `${w(b)}%` }} /></span>
    </div>
  );
}

// ---------- Stat tile ----------

export function KPI({ label, value, sub, tone, tip }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 't' | 'ct' | 'warn'; tip?: string }) {
  return (
    <div className="kpi" data-tip={tip} tabIndex={tip ? 0 : undefined}>
      <span className="label">{label}</span>
      <span className={`kpi-v num ${tone ? `tone-${tone}` : ''}`}>{value}</span>
      {sub !== undefined && <span className="kpi-s">{sub}</span>}
    </div>
  );
}
