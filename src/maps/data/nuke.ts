/**
 * Nuke: an original, hand-made approximation of the map's well-known structure (no Valve files,
 * overviews or images were used). Distances and shapes are approximate.
 *
 * Multi-level compromise: the real map stacks B site directly under A, but this format is a
 * single heightfield (one floor per cell). So the upper level (T spawn 8 m, lobby/radio/hut/
 * squeaky/A site/mini/CT 7 m, outside yard and garage 6 m, heaven and rafters 9.4 m) keeps its
 * usual footprint, and the whole lower level (ramp room, B site, back of B, double doors, decon,
 * toxic, secret bottom, vent bottom, all at 0-0.5 m) is moved NORTH of A, directly beside it.
 * The real connectors still descend between the two: the long Ramp from radio/lobby, the Vents
 * shaft dropping from the north-west of A (one-way, a chain of 2 m drops), the Decon stairs from
 * CT spawn, and Secret, the long slope from the outside yard down the east side into toxic.
 * Outside is south of the building, T spawn west, CT spawn east. T roof (10 m) sits between lobby
 * and the yard, reached by the silo stairs, with a railing over the yard.
 */
import type { MapSource } from '../types';

export const NUKE: MapSource = {
  name: 'Nuke',
  size: [124, 112],
  rooms: [
    // ---- T side (upper) ----
    [4, 46, 16, 26, 8], // T spawn (raised)
    [20, 53, 8, 8, 8, 7, 'x'], // trophy corridor, steps down into lobby
    [28, 46, 14, 18, 7], // lobby
    [28, 38, 10, 8, 7], // radio (top of ramp)
    [6, 72, 12, 8, 8], // T spawn south exit
    [6, 80, 12, 6, 8, 6, 'y'], // T outside steps
    [18, 82, 10, 10, 6], // T outside alley
    // ---- A level (7 m) ----
    [42, 46, 10, 3, 7], // squeaky corridor
    [42, 57, 10, 7, 7], // hut
    [52, 44, 22, 26, 7], // A site
    [74, 56, 6, 14, 7], // hell (under the end of heaven)
    [74, 44, 6, 12, 9.4], // heaven balcony
    [56, 40, 24, 4, 9.4], // rafters catwalk over the north wall of A
    [80, 44, 8, 4, 9.4, 7, 'x'], // heaven stairs from CT
    [80, 58, 8, 8, 7], // mini
    [88, 44, 16, 26, 7], // CT spawn
    [98, 36, 8, 8, 7], // control room
    [66, 70, 8, 10, 7, 6, 'y'], // main (big doors to outside)
    [82, 66, 6, 14, 7, 6, 'y'], // garage stairs up to mini
    // ---- Outside (6 m) ----
    [28, 80, 72, 30, 6], // outside yard
    [100, 92, 12, 8, 6], // secret entrance
    // ---- Connectors down to the lower level ----
    [28, 16, 8, 22, 0.5, 7, 'y'], // ramp (long slope north from radio)
    [52, 36, 3, 8, 7], // vent duct
    [52, 35, 3, 1, 4.8], // vent drop 1
    [52, 34, 3, 1, 2.6], // vent drop 2
    [52, 33, 3, 1, 0.5], // vent drop 3
    [48, 30, 10, 3, 0], // vent bottom
    [88, 24, 8, 20, 0, 7, 'y'], // decon stairs from CT
    [112, 6, 4, 90, 0, 6, 'y'], // secret: long narrow slope down from outside
    // ---- T roof (high ground over the yard, reached by the silo stairs) ----
    [30, 70, 28, 10, 10], // T roof
    [28, 70, 2, 10, 10, 6, 'y'], // silo stairs up to the roof
    // ---- Lower level (B, 0-0.5 m) ----
    [28, 4, 18, 12, 0.5], // ramp room
    [46, 2, 26, 8, 0], // back of B
    [46, 10, 26, 20, 0], // B site
    [72, 14, 8, 6, 0], // double doors
    [80, 8, 18, 16, 0], // decon bottom
    [98, 6, 12, 12, 0], // toxic
    [110, 8, 2, 4, 0], // toxic to secret
  ],
  walls: [
    [40, 49, 2, 8], // lobby back wall between squeaky and hut doors
    [34, 8, 2, 4], // ramp room pillar
  ],
  cover: [
    // T spawn / lobby
    [10, 52, 3, 3, 'X'],
    [12, 62, 2, 4, 'x'],
    [31, 50, 3, 2, 'x'], // lobby boxes
    [35, 58, 2, 3, 'X'],
    [30, 40, 2, 2, 'x'], // radio
    // Squeaky door and hut
    [47, 46, 1, 2, 'x'],
    [45, 59, 3, 3, 'X'], // hut box
    // A site
    [60, 53, 4, 4, 'X'], // big crates
    [56, 62, 2, 2, 'x'],
    [67, 48, 3, 2, 'x'],
    [69, 63, 2, 3, 'x'],
    [56, 43, 18, 1, '='], // rafters railing
    [74, 44, 1, 8, '='], // heaven railing (gap further south to drop)
    // Mini / CT
    [83, 60, 2, 2, 'x'],
    [93, 50, 3, 3, 'X'],
    [100, 60, 2, 3, 'x'],
    // Outside
    [36, 86, 6, 6, 'X'], // silo
    [36, 98, 6, 6, 'X'], // silo
    [56, 94, 10, 3, 'X'], // container
    [74, 86, 2, 4, 'x'],
    [88, 82, 5, 5, 'X'], // garage stacks
    [90, 98, 4, 3, 'x'],
    [104, 94, 2, 2, 'x'],
    [30, 79, 28, 1, '='], // roof edge railing over the yard
    [46, 84, 6, 3, 'X'], // T red container
    [40, 72, 3, 2, 'x'], // roof vent box
    [51, 74, 2, 2, 'x'], // roof vent box (east)
    // B site and lower
    [56, 16, 4, 3, 'X'], // B boxes
    [50, 24, 2, 2, 'x'],
    [64, 12, 3, 2, 'x'],
    [66, 22, 2, 3, 'X'],
    [50, 4, 3, 2, 'x'], // back of B
    [38, 12, 2, 2, 'x'], // ramp room
    [74, 14, 1, 2, 'X'], // double door frames
    [74, 18, 1, 2, 'X'],
    [86, 12, 3, 3, 'X'], // decon tanks
    [102, 10, 2, 3, 'x'], // toxic barrels
    // Set-dressing cover added for landmarks
    [46, 104, 9, 3, 'X'], // yellow truck parked at the south fence of the yard
    [79, 92, 2, 3, 'x'], // forklift outside garage
    [28, 24, 2, 3, 'x'], // ramp boxes against the west wall of ramp
  ],
  spawns: { T: [5, 47, 12, 22], CT: [89, 45, 13, 22] },
  regions: [
    { id: 't-spawn', name: 'T Spawn', zone: 'TS', rect: [4, 46, 16, 26] },
    { id: 'trophy', name: 'Trophy', zone: 'TS', rect: [20, 53, 8, 8] },
    { id: 'lobby', name: 'Lobby', zone: 'Mid', rect: [28, 46, 12, 18] },
    { id: 'radio', name: 'Radio', zone: 'B', rect: [28, 38, 10, 8] },
    { id: 't-outside', name: 'T Outside', zone: 'Mid', rect: [6, 72, 22, 20] },
    { id: 'outside', name: 'Outside', zone: 'Mid', rect: [44, 80, 40, 30] },
    { id: 'silo', name: 'Silo', zone: 'Mid', rect: [28, 80, 16, 30] },
    { id: 't-roof', name: 'T Roof', zone: 'Mid', rect: [28, 70, 30, 10] },
    { id: 'garage', name: 'Garage', zone: 'Mid', rect: [84, 78, 16, 22] },
    { id: 'garage-stairs', name: 'Garage Stairs', zone: 'A', rect: [82, 66, 6, 12] },
    { id: 'squeaky', name: 'Squeaky', zone: 'A', rect: [42, 46, 10, 3] },
    { id: 'hut', name: 'Hut', zone: 'A', rect: [42, 57, 10, 7] },
    { id: 'main', name: 'Main', zone: 'A', rect: [66, 70, 8, 10] },
    { id: 'a-site', name: 'A Site', zone: 'A', rect: [52, 44, 22, 26], site: 'A' },
    { id: 'heaven', name: 'Heaven', zone: 'A', rect: [74, 44, 14, 12] },
    { id: 'rafters', name: 'Rafters', zone: 'A', rect: [56, 40, 24, 4] },
    { id: 'hell', name: 'Hell', zone: 'A', rect: [74, 56, 6, 14] },
    { id: 'mini', name: 'Mini', zone: 'A', rect: [80, 58, 8, 8] },
    { id: 'ct-spawn', name: 'CT Spawn', zone: 'CTS', rect: [88, 44, 16, 26] },
    { id: 'control-room', name: 'Control Room', zone: 'CTS', rect: [98, 36, 8, 8] },
    { id: 'ramp', name: 'Ramp', zone: 'B', rect: [28, 16, 8, 22] },
    { id: 'ramp-room', name: 'Ramp Room', zone: 'B', rect: [28, 4, 18, 12] },
    { id: 'vents', name: 'Vents', zone: 'B', rect: [52, 33, 3, 11] },
    { id: 'vent-bottom', name: 'Vent Bottom', zone: 'B', rect: [48, 30, 10, 3] },
    { id: 'b-site', name: 'B Site', zone: 'B', rect: [46, 10, 26, 20], site: 'B' },
    { id: 'back-of-b', name: 'Back of B', zone: 'B', rect: [46, 2, 26, 8] },
    { id: 'double-doors', name: 'Double Doors', zone: 'B', rect: [72, 14, 8, 6] },
    { id: 'decon', name: 'Decon', zone: 'B', rect: [80, 8, 18, 16] },
    { id: 'decon-stairs', name: 'Decon Stairs', zone: 'CTS', rect: [88, 24, 8, 20] },
    { id: 'toxic', name: 'Toxic', zone: 'B', rect: [98, 6, 14, 12] },
    { id: 'secret', name: 'Secret', zone: 'B', rect: [112, 6, 4, 90] },
    { id: 'secret-entrance', name: 'Secret Entrance', zone: 'Mid', rect: [100, 92, 12, 8] },
  ],
  lanes: [
    { zone: 'A', via: ['trophy', 'lobby', 'hut', 'a-site'] },
    { zone: 'A', via: ['trophy', 'lobby', 'squeaky', 'a-site'] },
    { zone: 'A', via: ['t-outside', 'silo', 'outside', 'main', 'a-site'] },
    { zone: 'A', via: ['t-outside', 'silo', 'outside', 'garage', 'garage-stairs', 'mini', 'a-site'] },
    { zone: 'B', via: ['trophy', 'lobby', 'radio', 'ramp', 'ramp-room', 'b-site'] },
    { zone: 'B', via: ['t-outside', 'silo', 'outside', 'secret-entrance', 'secret', 'toxic', 'decon', 'double-doors', 'b-site'] },
    { zone: 'Mid', via: ['t-outside', 'silo', 'outside'] },
    { zone: 'Mid', via: ['t-outside', 'silo', 't-roof'] },
  ],
  ctHolds: { A: ['a-site', 'heaven', 'rafters', 'mini'], B: ['b-site', 'double-doors', 'back-of-b', 'vent-bottom'], Mid: ['garage', 'main', 'secret-entrance'] },
  // Measured side calibration (scratch/calib.ts, 864 rounds per value): T rounds 0.41 at 1.25, 0.40 at 1.5, 0.48 at 1.7.
  sideTune: 1.7,
  props: [
    // ---- T spawn / lobby ----
    { kind: 'crates', rect: [10, 52, 3, 3], h: 2.6, note: 'T spawn crate stack' },
    { kind: 'pallet', rect: [12, 62, 2, 4], note: 'T spawn pallets' },
    { kind: 'arch', rect: [20, 53, 1, 8], h: 3, note: 'T spawn doorway into trophy' },
    { kind: 'crates', rect: [31, 50, 3, 2], h: 1.1, note: 'lobby boxes' },
    { kind: 'crates', rect: [35, 58, 2, 3], h: 2.6, note: 'tetris (lobby stack by the hut door)' },
    { kind: 'crate', rect: [30, 40, 2, 2], h: 1.1, note: 'radio box at the top of ramp' },
    // ---- Squeaky / hut ----
    { kind: 'crate', rect: [47, 46, 1, 2], h: 1.1, note: 'squeaky box' },
    { kind: 'door', rect: [51, 46, 1, 3], h: 2.5, color: '#6f7a83', note: 'squeaky door (the creaky metal door onto A)' },
    { kind: 'machine', rect: [45, 59, 3, 3], h: 2.6, color: '#6d7f6a', note: 'hut generator cabinet' },
    { kind: 'door', rect: [42, 57, 1, 7], h: 2.8, note: 'hut doorway from lobby' },
    { kind: 'arch', rect: [51, 57, 1, 7], h: 2.8, note: 'hut opening onto A site' },
    // ---- A site / heaven / mini ----
    { kind: 'crates', rect: [60, 53, 4, 4], h: 3, color: '#4f6f8f', note: 'A site central box stack (big blue crates)' },
    { kind: 'crate', rect: [56, 62, 2, 2], h: 1.1, note: 'A front box' },
    { kind: 'crates', rect: [67, 48, 3, 2], h: 1.1, note: 'A boxes under heaven' },
    { kind: 'crate', rect: [69, 63, 2, 3], h: 1.1, note: 'main box at the top of main' },
    { kind: 'sign', rect: [51, 51, 1, 2], text: 'A', note: 'A site letter on the west wall' },
    { kind: 'lamp', rect: [58, 70, 1, 1], note: 'A site wall lamp' },
    { kind: 'door', rect: [80, 44, 1, 4], h: 2.6, note: 'heaven door from CT' },
    { kind: 'crate', rect: [83, 60, 2, 2], h: 1.1, note: 'mini box' },
    { kind: 'door', rect: [66, 79, 8, 1], h: 3.4, color: '#7d6a3a', note: 'main big sliding doors to outside' },
    { kind: 'tiles', rect: [66, 77, 8, 2], color: '#c9a227', note: 'hazard stripes at main doors' },
    { kind: 'door', rect: [82, 79, 6, 1], h: 3.2, color: '#6f7a83', note: 'garage roll-up door' },
    // ---- CT spawn ----
    { kind: 'crates', rect: [93, 50, 3, 3], h: 2.6, note: 'CT spawn crate stack' },
    { kind: 'barrel', rect: [100, 60, 2, 3], color: '#3d6f9e', note: 'CT spawn barrels' },
    { kind: 'lamp', rect: [104, 55, 1, 1], note: 'CT spawn wall lamp' },
    { kind: 'arch', rect: [88, 24, 8, 1], h: 2.8, note: 'decon stairwell door from CT' },
    // ---- Outside yard ----
    { kind: 'tank', rect: [36, 86, 6, 6], h: 9, color: '#c5ccd2', note: 'silo (north cooling tank)' },
    { kind: 'tank', rect: [36, 98, 6, 6], h: 9, color: '#c5ccd2', note: 'silo (south cooling tank)' },
    { kind: 'sand', rect: [30, 92, 12, 5], color: '#8a8478', note: 'gravel between the silos' },
    { kind: 'container', rect: [56, 94, 10, 3], h: 2.8, color: '#c9a227', note: 'yellow container in the middle of outside' },
    { kind: 'truck', rect: [46, 104, 9, 3], color: '#d1a52c', note: 'yellow truck at the south fence' },
    { kind: 'crates', rect: [74, 86, 2, 4], h: 1.1, note: 'outside crates by main' },
    { kind: 'container', rect: [88, 82, 5, 5], h: 5.5, color: '#3f6e8c', note: 'garage container stack' },
    { kind: 'forklift', rect: [79, 92, 2, 3], color: '#d4a62a', note: 'yellow forklift outside garage' },
    { kind: 'pallet', rect: [90, 98, 4, 3], note: 'pallets by secret' },
    { kind: 'barrel', rect: [104, 94, 2, 2], color: '#b8892a', note: 'secret entrance barrels' },
    { kind: 'door', rect: [112, 92, 1, 4], h: 2.6, note: 'secret door' },
    { kind: 'grass', rect: [28, 108, 18, 2], note: 'weedy verge along the south fence' },
    { kind: 'grass', rect: [76, 106, 22, 4], note: 'grass patch in the south-east of the yard' },
    { kind: 'grass', rect: [19, 87, 7, 4], note: 'grass in the T outside alley' },
    { kind: 'lamp', rect: [60, 79, 1, 1], note: 'yard flood lamp on the building wall' },
    { kind: 'lamp', rect: [64, 79, 1, 1], note: 'yard flood lamp on the building wall' },
    { kind: 'container', rect: [46, 84, 6, 3], h: 2.8, color: '#9b3b2f', note: 'T red (red container near the silos)' },
    { kind: 'machine', rect: [40, 72, 3, 2], h: 1.2, color: '#7b848c', note: 'roof vent unit' },
    { kind: 'machine', rect: [51, 74, 2, 2], h: 1.2, color: '#7b848c', note: 'roof vent unit (east)' },
    { kind: 'lamp', rect: [95, 79, 1, 1], note: 'yard flood lamp over garage' },
    { kind: 'tree', rect: [20, 96, 2, 2], note: 'pine outside the fence by T outside' },
    { kind: 'tree', rect: [12, 100, 2, 2], note: 'pine outside the fence' },
    { kind: 'tree', rect: [22, 104, 2, 2], note: 'pine outside the fence' },
    { kind: 'tree', rect: [34, 111, 1, 1], note: 'tree beyond the south fence' },
    { kind: 'tree', rect: [52, 111, 1, 1], note: 'tree beyond the south fence' },
    { kind: 'tree', rect: [70, 111, 1, 1], note: 'tree beyond the south fence' },
    { kind: 'tree', rect: [88, 111, 1, 1], note: 'tree beyond the south fence' },
    { kind: 'tree', rect: [104, 104, 2, 2], note: 'pine east of the yard' },
    { kind: 'tree', rect: [108, 107, 2, 2], note: 'pine east of the yard' },
    // ---- Ramp / B site / lower level ----
    { kind: 'arch', rect: [28, 37, 8, 1], h: 3, note: 'top of ramp doorway from radio' },
    { kind: 'crates', rect: [28, 24, 2, 3], h: 1.1, color: '#b8892a', note: 'ramp boxes' },
    { kind: 'crate', rect: [38, 12, 2, 2], h: 1.1, note: 'ramp room box' },
    { kind: 'pillar', rect: [34, 8, 2, 4], note: 'ramp room pillar' },
    { kind: 'crates', rect: [56, 16, 4, 3], h: 2.8, color: '#c9a227', note: 'B default boxes (big yellow crates)' },
    { kind: 'crate', rect: [50, 24, 2, 2], h: 1.1, note: 'B front box by vent bottom' },
    { kind: 'crates', rect: [64, 12, 3, 2], h: 1.1, note: 'B boxes by double doors' },
    { kind: 'crates', rect: [66, 22, 2, 3], h: 2.6, note: 'B dark corner stack' },
    { kind: 'crates', rect: [50, 4, 3, 2], h: 1.1, note: 'back of B boxes' },
    { kind: 'sign', rect: [45, 20, 1, 2], text: 'B', note: 'B site letter on the west wall' },
    { kind: 'tiles', rect: [52, 36, 3, 8], color: '#5c636b', note: 'vent duct grating' },
    { kind: 'door', rect: [74, 16, 1, 2], h: 2.6, color: '#6f7a83', note: 'double doors (heavy blast doors)' },
    { kind: 'tank', rect: [86, 12, 3, 3], h: 2.8, color: '#d6dbdf', note: 'decon chemical tanks' },
    { kind: 'tiles', rect: [80, 16, 8, 8], color: '#c8d0d6', note: 'decon white tiled floor' },
    { kind: 'barrel', rect: [102, 10, 2, 3], color: '#c9a227', note: 'toxic waste barrels' },
    { kind: 'water', rect: [105, 13, 3, 2], color: '#6e9a2e', note: 'toxic spill' },
    { kind: 'sign', rect: [102, 5, 3, 1], text: 'RAD', color: '#c9a227', note: 'radiation warning sign in toxic' },
  ],
  palette: { floor: '#8d949b', floorAlt: '#7e858d', wall: '#b9c0c7', wallTop: '#d3d9de', cover: '#4f6f8f', accent: '#3d7fc4', void: '#15181b' },
};
