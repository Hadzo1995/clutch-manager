import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The game dresses its own operator meshes onto the soldier's skeleton (operator.ts), so the
// skeleton's inverse bind matrices must be in model units. Quantizing a skinned mesh's POSITION
// (gltf-transform `quantize`) bakes the dequantization scale into those matrices, which made
// every dressed operator about 90x too big: invisible in the lobby and the live match.
describe('soldier.glb', () => {
  const glb = readFileSync(fileURLToPath(new URL('../src/ui/arena/assets/soldier.glb', import.meta.url)));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));

  it('keeps skinned vertex positions as floats', () => {
    const skinned = json.nodes.filter((n: { skin?: number; mesh?: number }) => n.skin !== undefined && n.mesh !== undefined);
    expect(skinned.length).toBeGreaterThan(0);
    for (const n of skinned) {
      for (const p of json.meshes[n.mesh].primitives) {
        expect(json.accessors[p.attributes.POSITION].componentType).toBe(5126); // FLOAT
      }
    }
  });

  it('has the clips the figures play', () => {
    const names = json.animations.map((a: { name: string }) => a.name);
    for (const c of ['Idle', 'Walk', 'Run']) expect(names).toContain(c);
  });
});
