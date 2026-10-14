import { ROTATIONS, type MacroCoord } from '../base/coords';

// The game the editor plans maps for, as facts: porting the editor to another game replaces this
// module and the catalog and map data, not the modules that read them.

/**
 * The map's grids and where each lies, in cells. Objects, roads and notes lie on the object grid,
 * the map's own lattice; terrain lies on the terrain grid, half a cell up and left of it, so a
 * terrain cell (x, y) covers [x - 0.5, x + 0.5).
 */
export const GRIDS = {
  object: { offset: { x: 0, y: 0 } },
  terrain: { offset: { x: -0.5, y: -0.5 } },
} as const satisfies Record<string, { readonly offset: Readonly<MacroCoord> }>;

/** The grid placed objects, coatings and notes lie on. */
export const PLACEMENT_GRID = 'object' satisfies keyof typeof GRIDS;
/** The grid terrain and water lie on. */
export const TERRAIN_GRID = 'terrain' satisfies keyof typeof GRIDS;

/** Cells on each side of a chunk, the unit of map size and load accounting. */
export const CHUNK_SIZE = 16;
/** How the game labels a chunk's row (A, B, C from the top, wrapping at Z) and column (1, 2, 3 from
 *  the left); a chunk's name is its row label then its column label. */
export const CHUNK_LABELS = {
  row: (cy: number): string => String.fromCharCode(65 + (cy % 26)),
  column: (cx: number): string => String(cx + 1),
} as const;
/** The load one chunk may carry. */
export const CHUNK_LOAD_LIMIT = 10_000;
/** Whether placement enforces the measured catalog loads. */
export const CHUNK_LOAD_ENABLED = true;
/** Decimal precision of measured object loads. */
export const LOAD_DECIMALS = 1;
/** The game this editor plans maps for, as the assistant names it. */
export const GAME_NAME = 'Petit Planet';

/** The highest terrain and water layer. */
export const ELEVATION_MAX = 8;
/** The highest layer the ground carries by itself; a terrain or water layer above it needs the layer
 *  beneath it in the same cell. */
export const GROUND_SUPPORT_LAYER = 1;

/** The game's terrain colours: the ground and each mountain layer, 0 to `ELEVATION_MAX`, and water. */
export const PALETTE = {
  elevation: ['#b1e291', '#A3D070', '#93c956', '#79c440', '#5cb837', '#4ca42a', '#3e941d', '#298c19', '#1b7511'],
  water: '#97e1ff',
} as const;

/** The bits a zone id takes in the share codec and the worker wire; every id is below `1 << ZONE_ID_BITS`. */
export const ZONE_ID_BITS = 3;

/** The ground kind of a map cell, its layer 0, by the id templates, saves and share codes store. */
export enum CellZone {
  Void = 0,
  Beach = 1,
  Grass = 2,
  // Id 3 is retired: the plaza is a landmark object standing on grass. Validation rejects it.
  Boundary = 4,
}

/** What a zone is to the editor. Shared code asks it through the predicates in `game/zones.ts`, never
 *  by a zone's id. */
export interface ZoneSpec {
  /** The English word the assistant reads it by. */
  readonly name: string;
  /** Buildings, objects and terrain may go on it. */
  readonly buildable: boolean;
  /** Land the layer-0 edits turn to and from sea. */
  readonly land: boolean;
  /** The ground a shore rim forms around and a `grass` landmark stands on. */
  readonly shoreSource: boolean;
  /** Read from the zone alone, the cell is sea: open sea, or a shore rim whose ground is unknown. */
  readonly sea: boolean;
  /** The derived shore rim (`model/shore.ts:deriveBoundary`); a rim cell keeps the ground under it.
   *  Exactly one zone. */
  readonly rim: boolean;
  /** The one ground a rim cell keeps under it (`MacroCell.under`); a rim over any other ground
   *  returns to the off-map zone. */
  readonly sand: boolean;
  /** A cell beyond the map reads as it, and a fresh planet canvas holds it. Exactly one zone. */
  readonly offMap: boolean;
  /** A terrain command may write it as a cell's ground (`GroundZone`). */
  readonly writable: boolean;
  /** Its 2D colour. */
  readonly color: string;
  /** What the 3D view draws for it: the recessed sea or the land slab. */
  readonly surface: 'sea' | 'land';
}

/** Every zone's traits, by id. */
export const ZONES = {
  [CellZone.Void]: { name: 'sea', buildable: false, land: false, shoreSource: false, sea: true, rim: false, sand: false, offMap: true, writable: true, color: PALETTE.water, surface: 'sea' },
  [CellZone.Beach]: { name: 'beach', buildable: false, land: true, shoreSource: false, sea: false, rim: false, sand: true, offMap: false, writable: true, color: '#ffe793', surface: 'land' },
  [CellZone.Grass]: { name: 'grass', buildable: true, land: true, shoreSource: true, sea: false, rim: false, sand: false, offMap: false, writable: true, color: PALETTE.elevation[0], surface: 'land' },
  // Read from its zone alone the rim is sea, but both views draw it as a land cell in its own sand
  // colour, over open sea as over sand.
  [CellZone.Boundary]: { name: 'boundary', buildable: false, land: false, shoreSource: false, sea: true, rim: true, sand: false, offMap: false, writable: false, color: '#f7c68c', surface: 'land' },
} as const satisfies Readonly<Record<CellZone, ZoneSpec>>;

/** A zone a terrain command may write as a cell's ground. */
export type GroundZone = { [Z in CellZone]: (typeof ZONES)[Z]['writable'] extends true ? Z : never }[CellZone];

/** The ground a shore rim cell keeps under it. */
export type SandZone = { [Z in CellZone]: (typeof ZONES)[Z]['sand'] extends true ? Z : never }[CellZone];

/**
 * The mountain-support rule (V-MTN-03): a mountain at `fromLayer` or higher stands on a centred
 * `window` by `window` square of cells whose mass reaches at least `reach` layers below it.
 * Lower layers stand on the ground.
 */
export const BASE_SUPPORT = { fromLayer: 4, reach: 3, window: 3 } as const;

/**
 * The walking room placement keeps open: a house's gate strip runs `gateStripWidth` cells across its
 * door, covering the door cell and the cells in front of it to `gateStripDepth` deep; a crossing
 * keeps a `crossingEndSide` square open centred on each end. A home whose footprint covers at least
 * `gateMinArea` cells has a gate; a smaller one is street furniture.
 */
export const CLEARANCE = { gateStripWidth: 3, gateStripDepth: 2, crossingEndSide: 3, gateMinArea: 4 } as const;

/**
 * The ground a landmark stands on. `grass`: every cell under its footprint is grass. `coast`: no cell
 * under it is grass, a cell along its landward edge (the footprint's north edge before any turn) is
 * land, and every cell along the opposite edge is open sea, so it reaches from the shore out over the
 * water.
 */
export type LandmarkGround = 'grass' | 'coast';

/** A fixed structure the game lays on a planet: each map holds at most one of each. */
export interface LandmarkSpec {
  /** Its object id on every map and its catalog item's id. Saves and share codes never carry it:
   *  the template places it. */
  readonly id: string;
  /** Unturned footprint in cells; its laid footprint swaps them at a quarter turn. */
  readonly width: number;
  readonly height: number;
  readonly ground: LandmarkGround;
  /** The landmark two planets are laid over each other by and the generators build around. */
  readonly anchor: boolean;
  /** Icon basename the object carries itself, for an item without one of its own. */
  readonly icon?: string;
  /** The planet editor offers it on its shelf. Every landmark is optional on a custom planet: the
   *  planet editor places, moves and removes it, and outside the planet editor it is locked. */
  readonly editorPlaceable: boolean;
  /** Where its visible structure lies inside its unturned footprint, as seen from above: cells from
   *  each footprint side to the structure's edge, inward positive (negative where the structure
   *  reaches past the side). Undefined when it is not recorded. */
  readonly structure?: { readonly west: number; readonly east: number; readonly north: number; readonly south: number };
}

/**
 * The game's landmarks, in the order planets hash and codecs write them. Footprints follow the
 * game's layout sheet: the Neighbor Center's plaza is 20 by 27 cells, the frame's outer half cell
 * left out on every side, and the station's reserved frame is 16 by 20 cells reaching south from
 * the beach over the sea. A landmark carries no height: it stands on whatever ground is under it.
 */
export const LANDMARKS: readonly LandmarkSpec[] = [
  { id: '__plaza__', width: 20, height: 27, ground: 'grass', anchor: true, icon: 'plaza', editorPlaceable: true },
  {
    id: 'facility-station', width: 16, height: 20, ground: 'coast', anchor: false, editorPlaceable: true,
    // The deck is narrower than the frame, its gangway starts on the beach and the deck reaches three
    // rows past the frame over the sea.
    structure: { west: 1.6, east: 1.5, north: 3.3, south: -3 },
  },
];

/** The anchor landmark, or undefined for a game whose planets have none. */
export const ANCHOR_LANDMARK: LandmarkSpec | undefined = LANDMARKS.find((l) => l.anchor);

/** The landmark whose object and item id is `id`, or undefined. */
export function landmarkSpec(id: string): LandmarkSpec | undefined {
  return LANDMARKS.find((l) => l.id === id);
}

/**
 * The game facts custom planets are built from. The planet model, its validator, codecs, session and
 * UI read them here, so another game's planets differ in this profile, not in the modules that read it.
 */
export const PLANET_PROFILE = {
  /** A custom planet is at most this many chunks on each side. */
  maxChunks: 16,
  /** Every sea or sand cell within this Chebyshev radius of grass is the shore rim, so the
   *  rim is one cell wide between the grass and whatever lies beyond. The built-in planets' Boundary
   *  cells are exactly this set. */
  shoreRadius: 1,
  /** The highest mountain layer a custom planet's ground may take while it is shaped; 0 keeps the
   *  ground flat. Planets saved with higher layers still load, keep them and may be lowered. */
  maxLayer: 0,
  /** Every custom template id starts with this; no built-in id does. */
  templatePrefix: 'custom-',
  /** The footprint turns a landmark may take while its planet is shaped. */
  rotations: ROTATIONS,
} as const;
