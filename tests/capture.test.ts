import { afterEach, describe, expect, it, vi } from 'vitest';

/** Capture builds (marketing footage) must show only the game's own content. */
describe('capture build', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('is off in normal builds, so the released game is unchanged', async () => {
    vi.resetModules();
    const { CAPTURE } = await import('../src/capture');
    const { DIVISIONS, cupName } = await import('../src/engine/season');
    const { realTeamByName, REAL_TEAMS } = await import('../src/engine/data/realTeams');
    expect(CAPTURE).toBe(false);
    expect(DIVISIONS[DIVISIONS.length - 1]!.name).toBe('ESL Pro League');
    expect(cupName(DIVISIONS.length - 1)).toBe('IEM Cologne');
    const first = Object.values(REAL_TEAMS)[0]!;
    expect(realTeamByName(first.name)).toBeDefined();
  });

  it('hides real league, event and organisation names when switched on', async () => {
    vi.stubEnv('VITE_CAPTURE', '1');
    vi.resetModules();
    const { CAPTURE, CAPTURE_TOP_DIVISION } = await import('../src/capture');
    const { DIVISIONS, cupName, CUP_NAME } = await import('../src/engine/season');
    const { realTeamByName, REAL_TEAMS } = await import('../src/engine/data/realTeams');
    expect(CAPTURE).toBe(true);
    expect(DIVISIONS[DIVISIONS.length - 1]!.name).toBe(CAPTURE_TOP_DIVISION);
    expect(cupName(DIVISIONS.length - 1)).toBe(CUP_NAME);
    for (const t of Object.values(REAL_TEAMS)) expect(realTeamByName(t.name)).toBeUndefined();
  });
});
