/**
 * Photo-scanned surface detail for the common map surfaces (floors, walls, facades, ground, roads, roof tiles),
 * from Poly Haven (CC0, https://polyhaven.com). Each is a greyscale detail map, prepared like the
 * procedural ones in materials.ts (mean ~0.82, multiplied by the map palette colour), plus a
 * normal map that gives joints, chips and grain real relief under the sun.
 *
 *   stones   red_sandstone_pavement    tiles    terracotta_floor_tiles
 *   concrete concrete_floor_02         blocks   sandstone_blocks_08
 *   plaster  beige_wall_001            sand     sand_01
 *   grass    grass_path_2              asphalt  asphalt_02
 *   sandstone old_sandstone_02         stucco   rough_plaster_brick_04
 *   roofTiles clay_roof_tiles_02 (UV mapped, not triplanar: its normal replaces roofTilesN)
 *
 * Files are 512 px WebP images in ./assets/surfaces (prepared from the 1K downloads).
 */
import * as THREE from 'three';
import stones from './assets/surfaces/stones.webp?url';
import stonesN from './assets/surfaces/stones_n.webp?url';
import tiles from './assets/surfaces/tiles.webp?url';
import tilesN from './assets/surfaces/tiles_n.webp?url';
import concrete from './assets/surfaces/concrete.webp?url';
import concreteN from './assets/surfaces/concrete_n.webp?url';
import blocks from './assets/surfaces/blocks.webp?url';
import blocksN from './assets/surfaces/blocks_n.webp?url';
import plaster from './assets/surfaces/plaster.webp?url';
import plasterN from './assets/surfaces/plaster_n.webp?url';
import sand from './assets/surfaces/sand.webp?url';
import sandN from './assets/surfaces/sand_n.webp?url';
import grass from './assets/surfaces/grass.webp?url';
import grassN from './assets/surfaces/grass_n.webp?url';
import asphalt from './assets/surfaces/asphalt.webp?url';
import asphaltN from './assets/surfaces/asphalt_n.webp?url';
import sandstone from './assets/surfaces/sandstone.webp?url';
import sandstoneN from './assets/surfaces/sandstone_n.webp?url';
import stucco from './assets/surfaces/stucco.webp?url';
import stuccoN from './assets/surfaces/stucco_n.webp?url';
import roofTiles from './assets/surfaces/roofTiles.webp?url';
import roofTilesN from './assets/surfaces/roofTiles_n.webp?url';

export type PhotoKey = 'stones' | 'tiles' | 'concrete' | 'blocks' | 'plaster' | 'sand' | 'grass' | 'asphalt' | 'sandstone' | 'stucco' | 'roofTiles';

export const PHOTO_URLS: Record<PhotoKey, [string, string]> = {
  stones: [stones, stonesN], tiles: [tiles, tilesN], concrete: [concrete, concreteN], blocks: [blocks, blocksN], plaster: [plaster, plasterN],
  sand: [sand, sandN], grass: [grass, grassN], asphalt: [asphalt, asphaltN], sandstone: [sandstone, sandstoneN], stucco: [stucco, stuccoN], roofTiles: [roofTiles, roofTilesN],
};

/**
 * A texture that shows `fallback` (the procedural canvas) until the photo has loaded, then swaps
 * its image in place, so materials built before the load pick it up without being rebuilt.
 */
export function photoTexture(url: string, fallback: HTMLCanvasElement | null): THREE.Texture {
  const t = new THREE.Texture(fallback ?? undefined);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace; // detail and normal maps are data, not colours
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (fallback) t.needsUpdate = true;
  const img = new Image();
  img.decoding = 'async';
  // Free the fallback's GPU storage first: the photo is a different size, so it needs a new upload.
  img.onload = () => { t.dispose(); t.image = img; t.needsUpdate = true; };
  img.src = url;
  return t;
}
