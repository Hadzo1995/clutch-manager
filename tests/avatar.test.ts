import { avatarDataUrl, avatarSvg, avatarTraits } from '../src/ui/avatar/avatar';
import type { AvatarOptions } from '../src/ui/avatar/avatar';

const seeds = Array.from({ length: 200 }, (_, i) => `player-${i}`);

describe('avatar generator', () => {
  it('is deterministic for the same seed and options', () => {
    for (const s of seeds.slice(0, 20)) {
      expect(avatarSvg(s)).toBe(avatarSvg(s));
      expect(avatarSvg(s, { kind: 'coach', accent: '#3a8dff' })).toBe(avatarSvg(s, { kind: 'coach', accent: '#3a8dff' }));
      expect(avatarTraits(s)).toEqual(avatarTraits(s));
    }
  });

  it('produces different svgs for different seeds', () => {
    const set = new Set(seeds.map((s) => avatarSvg(s)));
    expect(set.size).toBe(seeds.length);
  });

  it('covers a wide range of trait combinations', () => {
    const combos = new Set(seeds.map((s) => JSON.stringify(avatarTraits(s))));
    expect(combos.size).toBeGreaterThanOrEqual(150);
    const skins = new Set(seeds.map((s) => avatarTraits(s).skin));
    expect(skins.size).toBeGreaterThanOrEqual(8);
    const headwear = new Set(seeds.map((s) => avatarTraits(s).headwear.split('+')[0]));
    for (const h of ['none', 'headset', 'cap', 'cap-back', 'beanie', 'helmet', 'balaclava', 'hood']) expect(headwear).toContain(h);
  });

  it('keeps faces stable across team accents and gives coaches no tactical gear', () => {
    for (const s of seeds.slice(0, 50)) {
      expect(avatarTraits(s, { accent: '#ff0000' })).toEqual(avatarTraits(s));
      const c = avatarTraits(s, { kind: 'coach' });
      expect(['none', 'cap', 'headset']).toContain(c.headwear);
      expect(['polo', 'jacket', 'blazer']).toContain(c.jersey.split('+')[0]);
    }
  });

  it('outputs well-formed, compact svg', () => {
    const optsList: (AvatarOptions | undefined)[] = [undefined, { accent: '#3a8dff' }, { kind: 'coach' }, { kind: 'coach', accent: '#e34' }, { accent: 'not-a-colour' }];
    let total = 0;
    let count = 0;
    for (const o of optsList) {
      for (const s of seeds.slice(0, 60)) {
        const svg = avatarSvg(s, o);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('viewBox="0 0 120 120"');
        expect(svg).not.toMatch(/undefined|NaN|Infinity/);
        expect(svg).not.toMatch(/<image|<text|<filter|feGaussianBlur|href=/);
        expect((svg.match(/<g\b/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
        total += svg.length;
        count++;
      }
    }
    expect(total / count).toBeLessThan(6144);
  });

  it('uses ids that are unique per seed+options and are all defined', () => {
    const idsOf = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!);
    const seen = new Map<string, string>();
    const variants: [string, AvatarOptions | undefined][] = [];
    for (const s of seeds.slice(0, 80)) variants.push([s, undefined], [s, { accent: '#3a8dff' }], [s, { kind: 'coach' }]);
    for (const [s, o] of variants) {
      const svg = avatarSvg(s, o);
      const ids = idsOf(svg);
      expect(new Set(ids).size).toBe(ids.length);
      for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1]);
      const key = `${s}|${JSON.stringify(o)}`;
      for (const id of ids) {
        const prev = seen.get(id);
        if (prev !== undefined) expect(prev).toBe(key);
        seen.set(id, key);
      }
    }
  });

  it('builds a properly encoded, memoised data url', () => {
    const url = avatarDataUrl('player-1', { accent: '#3a8dff' });
    expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(url).not.toMatch(/[#<>"\s]/);
    expect(decodeURIComponent(url.slice('data:image/svg+xml;utf8,'.length))).toBe(avatarSvg('player-1', { accent: '#3a8dff' }));
    expect(avatarDataUrl('player-1', { accent: '#3a8dff' })).toBe(url);
    for (let i = 0; i < 800; i++) avatarDataUrl(`flood-${i}`);
    expect(avatarDataUrl('player-1', { accent: '#3a8dff' })).toBe(url);
  });
});
