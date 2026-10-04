/**
 * The planet editor as a session over the live map.
 *
 * Entering parks the live map by identity (grid, executor and undo stack, selection, layers, edit
 * mode, view mode, and the cameras the caller read) and installs a scratch canvas under the planet
 * rules; leaving hands the parked map back unchanged and returns its cameras for the caller to queue.
 * Neither saves anything nor touches a view: persistence and cameras belong to the caller.
 */
import { PLANET_PROFILE, CHUNK_SIZE } from '../../core/model/game-profile';
import {
  cropPlanet, groundFrame, groundUnderRim, planetPlazaObject, refreshBoundary, turnedPlaza, NO_PLANET_PLAZA, PLANET_CANVAS_ID_PREFIX, PLANET_MAX_CELLS,
  type PlanetCrop, type PlanetFrame,
} from '../../core/model/planet';
import { bumpCellsVersion, groundZone, hasLandmark, isGrassZone, templateLandmark } from '../../core/model/grid-model';
import {
  CellZone, type GridState, type MacroCoord, type MapTemplate, type PlaceObjectCommand, type Rotation,
  type PlacedObject, type PlazaConfig, type ValidationError, type ValidationResult,
} from '../../core/model/types';
import { createPlanetRegistry } from '../../rules/index';
import { hasTrait } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { objectPlacementCommand, planObjectPlacement, removeObjectCommand } from '../../tools/objects/object-placer';
import type { PlanetEntry } from '../../io/planet-library';
import type { PlanetReview } from '../../state/slices/planet-session';
import type { PersistedCamera } from '../../io/save-format/types';
import { currentKit, currentPlanetSession, editorEventBus, installPlanetCanvas, parkLiveEditor, restoreParkedMap } from '../context';

/** Numbers each session's canvas id; the id names no planet and is never persisted. */
let canvasSessions = 0;

/** A planet not in the library, opened as a new one: a template with the sand under its rim, and
 *  what a planet read from a scan asks the person to check. */
export interface PlanetDraft {
  readonly template: MapTemplate;
  /** Row-major template indices of rim cells whose ground is sand (`rimSandOf`). */
  readonly rimSand?: readonly number[];
  readonly review?: {
    /** Row-major template indices of the cells to check. */
    readonly cells: readonly number[];
    /** The landmark's place or turn was inferred. */
    readonly landmark: boolean;
  };
}

const isEntry = (source: PlanetEntry | PlanetDraft): source is PlanetEntry => 'entryId' in source;

/**
 * An all-sea canvas at the size cap; a planet being edited is embedded at a chunk-aligned offset,
 * `at` in cells. Its zones are the ground each cell stands on, a stored rim cell read by
 * `groundUnderRim` from the planet's `rimSand`, with no rim: the session derives the rim on the
 * installed cells.
 */
function canvasTemplate(planet: PlanetDraft | null, name: string): { template: MapTemplate; at: MacroCoord } {
  const n = PLANET_MAX_CELLS;
  const ground = Array.from({ length: n }, () => Array.from({ length: n }, (): CellZone => CellZone.Void));
  const terrain = new Uint8Array(n * n);
  const water = new Uint8Array(n * n);
  let plaza: PlazaConfig = { ...NO_PLANET_PLAZA };
  let at: MacroCoord = { x: 0, y: 0 };
  if (planet) {
    const t = planet.template;
    const under = groundUnderRim(t.zones, planet.rimSand);
    const ox = Math.floor((n - t.width) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const oy = Math.floor((n - t.height) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    at = { x: ox, y: oy };
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
      const z = under[y]![x]!;
      ground[y + oy]![x + ox] = isGrassZone(z) ? CellZone.Grass : z;
      terrain[(y + oy) * n + x + ox] = t.terrain?.[y * t.width + x] ?? 0;
      water[(y + oy) * n + x + ox] = t.water?.[y * t.width + x] ?? 0;
    }
    if (hasLandmark(t.plaza)) plaza = { ...t.plaza, x: t.plaza.x + ox, y: t.plaza.y + oy };
  }
  const template: MapTemplate = {
    id: `${PLANET_CANVAS_ID_PREFIX}${++canvasSessions}`,
    name: { en: name },
    width: n,
    height: n,
    zones: ground,
    plaza,
    terrain,
    water,
    chunkGrid: { origin: { x: 0, y: 0 }, columns: PLANET_PROFILE.maxChunks, rows: PLANET_PROFILE.maxChunks },
  };
  return { template, at };
}

/** A draft's review on the canvas, its cells moved by `at`. */
function canvasReview(draft: PlanetDraft, at: MacroCoord): PlanetReview | undefined {
  const review = draft.review;
  if (!review) return undefined;
  const w = draft.template.width;
  return {
    cells: review.cells.map((i) => ({ x: (i % w) + at.x, y: Math.floor(i / w) + at.y })),
    landmark: review.landmark,
  };
}

let unfollowShore: (() => void) | null = null;

/**
 * Keeps the canvas's shore rim derived while the session runs: after every cells change, sea and sand
 * near the changed cells are re-derived and the cells that changed are announced for the views. The
 * rim is not an edit, so it stays out of the history. Only commands change the ground under a rim
 * cell, and their cell snapshots carry it, so undo and redo re-derive the rim from the ground they
 * restore.
 */
function followShore(): void {
  unfollowShore?.();
  const bus = editorEventBus();
  let deriving = false;
  const onCells = ({ cells }: { cells: MacroCoord[] }) => {
    const state = sessionKit()?.state;
    // The rim depends on ground alone, so the cells it announces need no pass of their own.
    if (!state || deriving) return;
    const changed = refreshBoundary(state.cells, cells);
    if (changed.length === 0) return;
    bumpCellsVersion(state);
    deriving = true;
    try { bus.emit('cells-changed', { cells: changed }); } finally { deriving = false; }
  };
  bus.on('cells-changed', onCells);
  unfollowShore = () => { bus.off('cells-changed', onCells); unfollowShore = null; };
}

/**
 * Parks the live map with `cameras`, each view's camera as the caller read it, and opens `source` on
 * the scratch canvas: a saved entry, a draft opened as a new planet (one read from a scan), or a
 * blank sea for a new planet when null. No-op inside a session or before a map is loaded.
 */
export function enterPlanetSession(source: PlanetEntry | PlanetDraft | null, cameras: PersistedCamera = {}): void {
  if (currentPlanetSession()) return;
  const parked = parkLiveEditor(cameras.view2d ?? null, cameras.view3d ?? null);
  if (!parked) return;
  const entry = source && isEntry(source) ? source : null;
  // An unreviewed name stays off the canvas, whose name any surface may show.
  const { template, at } = canvasTemplate(source, entry?.nameReviewed ? entry.name : '');
  const review = source && !entry ? canvasReview(source, at) : undefined;
  installPlanetCanvas(template, createPlanetRegistry(), {
    entryId: entry?.entryId ?? null,
    name: entry?.name ?? '',
    nameReviewed: entry?.nameReviewed ?? true,
    parked,
    ...(review ? { review } : {}),
  });
  // One full pass lays the rim on the installed ground, keeping the sand under it on the cells.
  const state = sessionKit()?.state;
  if (state) {
    const rim = refreshBoundary(state.cells, [], 0);
    if (rim.length > 0) {
      bumpCellsVersion(state);
      editorEventBus().emit('cells-changed', { cells: rim });
    }
  }
  followShore();
}

/**
 * Reinstates the parked map by identity and returns the cameras it was parked with, for the caller to
 * queue for the views: null when none was read. No-op returning null outside a session.
 */
export function leavePlanetSession(): PersistedCamera | null {
  const session = currentPlanetSession();
  if (!session) return null;
  const { parked } = session;
  unfollowShore?.();
  restoreParkedMap(parked);
  return parked.camera2d || parked.camera3d
    ? { ...(parked.camera2d ? { view2d: parked.camera2d } : {}), ...(parked.camera3d ? { view3d: parked.camera3d } : {}) }
    : null;
}

/** The whole chunks the canvas's ground and plaza cover, or null when it has no ground. */
export function sessionFrame(state: GridState): PlanetFrame | null {
  return groundFrame(state.cells.map((row) => row.map(groundZone)), templateLandmark(state));
}

/** A planet as the session saves it: the template and the sand its rim hides (`rimSandOf`). */
export type SessionPlanet = PlanetCrop;

/** Whether the canvas holds any ground (grass or beach); the planet has none to save until it does. */
export function sessionHasGround(state: GridState | null): boolean {
  return !!state && sessionFrame(state) !== null;
}

/**
 * The planet drawn on the canvas (`cropPlanet`): ground and plaza cropped to their chunk frame, shore
 * derived from the ground under it, mountain elevations, water and the plaza translated into the crop,
 * with the sand under the rim. Null when the canvas has no ground.
 */
export function sessionPlanet(state: GridState): SessionPlanet | null {
  const ground = state.cells.map((row) => row.map(groundZone));
  const cut = cropPlanet(ground, templateLandmark(state), (x, y) => state.cells[y]?.[x]?.terrain, state.template.name.en ?? '');
  return cut && { template: cut.template, rimSand: cut.rimSand };
}

/** `sessionPlanet`'s template. */
export function sessionTemplate(state: GridState): MapTemplate | null {
  return sessionPlanet(state)?.template ?? null;
}

/** The session's planet named `name`; the session stays open so the caller can save before leaving. `empty` outside a session. */
export function finishPlanetSession(name: string): ({ ok: true } & SessionPlanet) | { ok: false; reason: 'empty' } {
  const state = sessionKit()?.state;
  const p = state ? sessionPlanet(state) : null;
  return p ? { ok: true, template: { ...p.template, name: { en: name } }, rimSand: p.rimSand } : { ok: false, reason: 'empty' };
}

/**
 * Whether `obj` turns through the session's footprint turn: a planet session is open, the object is
 * unlocked and its item declares `footprintTurn`. The one test every rotate entry point asks.
 */
export function turnsInSession(obj: PlacedObject | null | undefined, inSession: boolean = currentPlanetSession() !== null): boolean {
  if (!obj || !inSession || obj.locked) return false;
  const item = getCatalogItem(obj.catalogId);
  return !!item && hasTrait(item, 'footprintTurn');
}

/** A session plaza edit's result; `cmd` is the placement it made or refused, for the caller's spin or toast. */
export type SessionPlazaResult = ValidationResult & { cmd?: PlaceObjectCommand };

const NOT_IN_SESSION: SessionPlazaResult = { success: false, errors: [] };

/** A commit's outcome: the post-stroke rules reverted the edit when they report violations. */
function committed(violations: ValidationError[], cmd?: PlaceObjectCommand): SessionPlazaResult {
  return { success: violations.length === 0, errors: violations, ...(cmd ? { cmd } : {}) };
}

/** The live editor while a planet session is open. */
function sessionKit() {
  return currentPlanetSession() ? currentKit() : null;
}

/**
 * Places the plaza with its top-left at `at` (half cells allowed) as one undo step. The rules decide:
 * V-PLACE-MAX refuses a second plaza and V-ZONE-01 anything off grass. Refused outside a session.
 */
export function placeSessionPlaza(at: MacroCoord, rotation: Rotation): SessionPlazaResult {
  const kit = sessionKit();
  if (!kit) return NOT_IN_SESSION;
  const cmd = objectPlacementCommand(planetPlazaObject(at, rotation));
  return kit.executor.transaction({}, (tx): SessionPlazaResult => {
    const res = kit.executor.execute(cmd);
    if (!res.success) return { ...res, cmd };
    return committed(tx.commit(), cmd);
  });
}

/**
 * Turns the session plaza `quarterTurns` quarters clockwise about its centre as one undo step (remove
 * and place). The turned footprint is validated before anything moves, so a refusal leaves the plaza
 * as it was.
 */
export function rotateSessionPlaza(quarterTurns: 1 | 2 | 3 = 1): SessionPlazaResult {
  const kit = sessionKit();
  const plaza = kit ? templateLandmark(kit.state) : undefined;
  if (!kit || !plaza) return NOT_IN_SESSION;
  let turned = plaza;
  for (let i = 0; i < quarterTurns; i++) turned = turnedPlaza(turned);
  const { cmd, errors } = planObjectPlacement(kit.executor, kit.state, plaza, turned);
  if (errors.length > 0) return { success: false, errors, cmd };
  return kit.executor.transaction({}, (tx): SessionPlazaResult => {
    kit.executor.execute(removeObjectCommand(plaza));
    const res = kit.executor.execute(cmd);
    if (!res.success) {
      tx.rollback();
      return { ...res, cmd };
    }
    return committed(tx.commit(), cmd);
  });
}

/** Removes the session plaza as one undo step. Refused outside a session or with no plaza. */
export function removeSessionPlaza(): ValidationResult {
  const kit = sessionKit();
  const plaza = kit ? templateLandmark(kit.state) : undefined;
  if (!kit || !plaza) return NOT_IN_SESSION;
  return kit.executor.transaction({}, (tx) => {
    const res = kit.executor.execute(removeObjectCommand(plaza));
    return res.success ? committed(tx.commit()) : res;
  });
}
