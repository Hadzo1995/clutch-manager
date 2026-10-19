/**
 * Map geometry for the match viewer.
 *
 * Every map is an original, hand-drawn approximation of a CS2 layout on a grid.
 * It keeps what matters for reading a round from above (lanes, chokepoints,
 * sites, mid, cover, high ground) and nothing from Valve's files: no geometry,
 * textures or models were copied. Distances are approximate.
 *
 * A map is written as rectangles, painted in order:
 *   rooms  walkable floor. [x, y, w, h] at height 0, [x, y, w, h, height], or a
 *          ramp [x, y, w, h, fromHeight, toHeight, 'x' | 'y'] rising along that axis.
 *          Heights are metres (fractions allowed). One cell is one metre.
 *   walls  solid blocks cut into rooms (pillars, dividers)
 *   cover  [x, y, w, h, kind]: 'x' low cover (blocks movement, not sight),
 *          'X' tall cover (blocks both), '=' railing or window (blocks movement, not sight)
 * Every empty cell touching floor becomes a wall, so outlines come for free.
 * Walking: up at most STEP_UP between neighbouring cells (so a 1 m rise needs a
 * ramp at least 2 cells long), down at most DROP_DOWN (drops are one way).
 * A height change bigger than that is a ledge. Sight is blocked by walls, tall
 * cover and raised floor that rises above the line between two players' eyes.
 * Coordinates are cells: x to the right, y down.
 */
import type { MapName } from '../engine/types';

export const CELL = 1.0; // metres per cell
export const HEIGHT_UNIT = 1.0; // heights are written in metres
export const WALL_HEIGHT = 3.6;
/** Highest step a player can walk up between neighbouring cells (stairs and ramps stay under it). */
export const STEP_UP = 0.6;
/** Highest ledge a player will drop down (one way: you can't climb back up). */
export const DROP_DOWN = 2.6;
/** Eye height for line-of-sight checks. */
export const EYE = 1.6;

export type MapZone = 'A' | 'B' | 'Mid' | 'TS' | 'CTS';

export interface RegionSource {
  /** Short stable id, e.g. "a-site", "palace". */
  id: string;
  /** Callout shown on the map, e.g. "Palace". */
  name: string;
  zone: MapZone;
  /** [x, y, w, h] in cells, x to the right, y down. */
  rect: [number, number, number, number];
  /** Bombsite (exactly one for A and one for B). */
  site?: 'A' | 'B';
  /** Grid maps: the region owns only the cells inside rect marked with this code in grid.regions. */
  code?: string;
}

export interface LaneSource {
  /** Where this T lane goes. Mid lanes end in mid; A and B lanes end on the site. */
  zone: 'A' | 'B' | 'Mid';
  /** Region ids the lane passes through, in order, from T spawn outward. */
  via: string[];
}

export type RoomRect = [number, number, number, number] | [number, number, number, number, number] | [number, number, number, number, number, number, 'x' | 'y'];
export type CoverRect = [number, number, number, number, 'x' | 'X' | '='];

/**
 * Set dressing: recognisable landmarks drawn by the 3D viewer. Props never change
 * the game; movement and sight come only from rooms, walls and cover.
 *  - Solid props skin something that already blocks: every cell of their rect
 *    must be cover ('x' or 'X') or wall. Use them to turn a cover box into a car,
 *    a stack of crates, a barrel group, a pillar...
 *  - Flat props lie on the floor and can go anywhere (water, grass, rubble, rugs,
 *    painted site letters).
 *  - Frames ('door', 'arch') span an opening above head height; their posts stand
 *    in the walls either side, so they can sit over floor cells.
 *  - Outdoor props ('tree', 'palm', 'lamp', 'awning', 'sign', 'vines') must
 *    stand on wall or cover cells, or on empty cells outside the map.
 */
export type SolidPropKind = 'crate' | 'crates' | 'barrel' | 'car' | 'van' | 'truck' | 'forklift' | 'container' | 'tank' | 'pillar' | 'statue' | 'rock' | 'sandbags' | 'fountain' | 'well' | 'pallet' | 'machine' | 'planter' | 'bench' | 'cart';
export type FlatPropKind = 'water' | 'grass' | 'rubble' | 'rug' | 'tiles' | 'sand';
export type FramePropKind = 'door' | 'arch';
export type OutdoorPropKind = 'tree' | 'palm' | 'lamp' | 'awning' | 'sign' | 'vines';
export type PropKind = SolidPropKind | FlatPropKind | FramePropKind | OutdoorPropKind;
export const SOLID_PROPS: readonly SolidPropKind[] = ['crate', 'crates', 'barrel', 'car', 'van', 'truck', 'forklift', 'container', 'tank', 'pillar', 'statue', 'rock', 'sandbags', 'fountain', 'well', 'pallet', 'machine', 'planter', 'bench', 'cart'];
export const FLAT_PROPS: readonly FlatPropKind[] = ['water', 'grass', 'rubble', 'rug', 'tiles', 'sand'];
export const FRAME_PROPS: readonly FramePropKind[] = ['door', 'arch'];
export const OUTDOOR_PROPS: readonly OutdoorPropKind[] = ['tree', 'palm', 'lamp', 'awning', 'sign', 'vines'];

export interface PropSource {
  kind: PropKind;
  /** [x, y, w, h] in cells. For frames: the opening the frame spans. */
  rect: [number, number, number, number];
  /** Height in metres (defaults per kind). For frames: height of the opening. */
  h?: number;
  /** Tint, e.g. '#7a3b2e' for a red car (defaults per kind and map palette). */
  color?: string;
  /** Text for 'sign' props (a few characters, e.g. 'A'). */
  text?: string;
  /** What it is, for readers: e.g. "B car", "Goose crate". */
  note?: string;
}

/**
 * A map written cell by cell (rebuilt from top-down references, see scratch/mapref).
 * rows: ' ' void, '.' floor, 'x' low cover, 'X' tall cover, '=' rail, '#' wall.
 * heights: one char per cell, floor height in tenths of a metre as (code - 48).
 * regions: one char per cell, the code of the region that owns it ('-' none).
 */
export interface GridSource {
  rows: string[];
  heights: string[];
  regions: string[];
  /** Highest step a player can walk up between neighbouring cells on this map (metres). */
  stepUp?: number;
  /**
   * Walkable connections the single-layer grid can't show: a passage that runs
   * under a bridge. Each entry joins cell (x1, y1) to cell (x2, y2) both ways.
   */
  links?: [number, number, number, number][];
}

export interface MapSource {
  name: MapName;
  /** Grid size in cells. */
  size: [number, number];
  rooms: RoomRect[];
  /** Cell-by-cell geometry; when present, rooms are painted on top of it. */
  grid?: GridSource;
  walls?: [number, number, number, number][];
  cover?: CoverRect[];
  /** Spawn areas [x, y, w, h]; must be floor. */
  spawns: { T: [number, number, number, number]; CT: [number, number, number, number] };
  regions: RegionSource[];
  lanes: LaneSource[];
  /** Where CTs hold each area, as region ids (several = spread out). */
  ctHolds: Record<'A' | 'B' | 'Mid', string[]>;
  /** Set dressing for the 3D view (see PropSource). */
  props?: PropSource[];
  /** Floor and wall colours for the renderer. */
  palette: { floor: string; floorAlt: string; wall: string; wallTop: string; cover: string; accent: string; void: string };
  /**
   * Side calibration for the round simulation, measured, not taken from the game:
   * CT reaction time is multiplied by this and T reaction time divided by it.
   * Above 1 helps Ts. Exists because the bots, not the geometry, decide how a
   * traced map plays; see MAPS.md "Side calibration".
   */
  sideTune?: number;
}

export type CellKind = 'void' | 'wall' | 'floor' | 'low' | 'tall' | 'rail';

export interface Region extends RegionSource {
  /** Centre in cell coordinates (a walkable cell inside the rect). */
  center: [number, number];
  /** Walkable cells inside the rect. */
  cells: [number, number][];
}

export interface MapGeometry {
  name: MapName;
  w: number;
  h: number;
  kind: CellKind[]; // row-major
  height: number[]; // floor height in units for walkable cells, top height reference for others
  regions: Region[];
  regionById: Map<string, Region>;
  lanes: LaneSource[];
  ctHolds: Record<'A' | 'B' | 'Mid', string[]>;
  tSpawn: [number, number][];
  ctSpawn: [number, number][];
  sites: Record<'A' | 'B', Region>;
  palette: MapSource['palette'];
  props: PropSource[];
  /** Highest walkable step between neighbouring cells (metres). */
  stepUp: number;
  /** Grid maps: region code per cell (see GridSource.regions). */
  regionCode?: string[];
  /** Grid maps: extra walkable connections, cell index to linked cell indices (see GridSource.links). */
  links?: Map<number, number[]>;
  /** Cells a link passes under, with the floor height of the passage below (metres). */
  under?: Map<number, number>;
  /** See MapSource.sideTune (1 when the map has none). */
  sideTune: number;
}
