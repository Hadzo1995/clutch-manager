/** Small shared pieces for the Home, League and Club screens. */
import type { SeasonState } from '../../engine/season';

export type Result = 'W' | 'L';

/** A team's results this season (league, playoffs and cup), oldest first. */
export function teamForm(season: SeasonState, teamId: string): Result[] {
  return season.fixtures
    .filter((f) => f.result && (f.home === teamId || f.away === teamId))
    .sort((a, b) => a.week - b.week)
    .map((f) => (f.result!.winner === teamId ? 'W' : 'L'));
}

/** Last `n` results as W/L pills, oldest on the left. Empty slots keep the column width steady. */
export function FormPills({ form, n = 5, pad = true }: { form: Result[]; n?: number; pad?: boolean }) {
  const recent = form.slice(-n);
  const blanks = pad ? Math.max(0, n - recent.length) : 0;
  return (
    <span className="hm-fp" aria-label={recent.length ? `Last ${recent.length}: ${recent.join(' ')}` : 'No results yet'}>
      {recent.map((r, i) => <i key={i} className={r === 'W' ? 'w' : 'l'} aria-hidden="true">{r}</i>)}
      {Array.from({ length: blanks }, (_, i) => <i key={`b${i}`} className="e" aria-hidden="true" />)}
    </span>
  );
}

/** Signed number with a real minus sign. */
export function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString('en-US')}` : n < 0 ? `−${Math.abs(n).toLocaleString('en-US')}` : '0';
}

export function money(n: number): string {
  return n < 0 ? `−${Math.abs(n).toLocaleString('en-US')}` : n.toLocaleString('en-US');
}
