// Packs the soldier model (src/ui/arena/assets/soldier.glb) from the unpacked original
// (git show 1c35bad^:src/ui/arena/assets/soldier.glb > soldier-src.glb).
// Needs: npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
// Run:   node tools/pack-soldier.mjs soldier-src.glb src/ui/arena/assets/soldier.glb
//
// POSITION is NOT quantized: on a skinned mesh that bakes the dequantization scale into the
// inverse bind matrices, and the game binds its own operator meshes to that skeleton, so every
// operator came out ~90x too big (tests/soldierModel.test.ts guards this).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
// Only the first UV set is used.
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives())
  for (const s of p.listSemantics()) if (/^TEXCOORD_[1-9]/.test(s)) p.setAttribute(s, null);
await doc.transform(
  prune(), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ pattern: /^(NORMAL|TEXCOORD_0|WEIGHTS_0)$/ }),
);
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(out, doc);
