import { describe, expect, it } from 'vitest';
import { betaDay, betaDays, dueSurvey } from '../src/online/beta';
import type { BetaStatus } from '../src/online/beta';

const DAY = 86_400_000;
const start = Date.parse('2026-11-02T00:00:00+01:00');
const s: BetaStatus = { gate: true, startsAt: start, endsAt: Date.parse('2026-12-03T00:00:00+01:00'), maxPlayers: 50, players: 0, invited: true, now: start };

describe('closed beta calendar', () => {
  it('counts 31 days from 2 November to 2 December', () => {
    expect(betaDays(s)).toBe(31);
    expect(betaDay(s, start + 1000)).toBe(1);
    expect(betaDay(s, start + 30 * DAY + 1000)).toBe(31);
  });
  it('asks for the week-2 survey from day 14 and the final one from day 26', () => {
    expect(dueSurvey(s, start + 12 * DAY)).toBeNull();
    expect(dueSurvey(s, start + 13 * DAY + 1000)).toBe('week2');
    expect(dueSurvey(s, start + 25 * DAY + 1000)).toBe('final');
  });
});
