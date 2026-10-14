/**
 * The planet editor as a session over the live map.
 *
 * Entering parks the live map by identity (grid, executor and undo stack, selection, layers, edit
 * mode, view mode, and the cameras the caller read) and installs a scratch canvas under the planet
 * rules; leaving hands the parked map back unchanged and returns its cameras for the caller to queue.
 * Neither saves anything nor touches a view: persistence and cameras belong to the caller.
 */
import { removeObjectCommand } from '../../core/model/command-build';
import { ANCHOR_LANDMARK, PLANET_PROFILE, CHUNK_SIZE, TERRAIN_GRID } from '../../core/game/profile';
import { cropPlanet, groundFrame, PLANET_MAX_CELLS, type PlanetCrop, type PlanetFrame } from '../../core/model/planet';
import { groundUnderRim, refreshBoundary } from '../../core/model/shore';
import { turnedLandmark, hasLandmark, landmarkObjects } from '../../core/model/landmarks';
import { PLANET_CANVAS_ID_PREFIX } from '../../tools/generation/run';
import { bumpCellsVersion } from '../../core/model/grid-model';
import { groundZone, OFF_MAP_ZONE, type CellZone } from '../../core/game/zones';
import { type GridState, type LandmarkConfig, type MacroCoord, type MapTemplate, type PlaceObjectCommand, type PlacedObject, type ValidationError, type ValidationResult } from '../../core/model/types';
import { createPlanetRegistry } from '../../rules/index';
import { hasTrait } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { type QuarterTurn } from '../../tools/objects';
import { planObjectPlacement } from '../../tools/placement';
import type { PlanetReview, PlanetSession } from '../../state/slices/planet-session';
import type { ViewCameras } from '../../state/view-camera';
import type { SessionPort } from '../session/context';
import { cellSet, type CellSet } from '../../core/grid/grids';
import { cellsOn } from '../../core/grid/grid-convert';

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
    /** Ids of the landmarks the scan left for the person to place. */
    readonly unplaced?: readonly string[];
  };
}

/** A saved planet opened for editing: its draft, and the library entry saving it replaces. A
 *  library entry is one. */
export interface SessionEntry extends PlanetDraft {
  readonly entryId: string;
  readonly name: string;
  readonly nameReviewed: boolean;
}

const isEntry = (source: SessionEntry | PlanetDraft): source is SessionEntry => 'entryId' in source;

/**
 * An all-sea canvas at the size cap; a planet being edited is embedded at a chunk-aligned offset,
 * `at` in cells. Its zones are the ground each cell stands on, a stored rim cell read by
 * `groundUnderRim` from the planet's `rimSand`, with no rim: the session derives the rim on the
 * installed cells.
 */
function canvasTemplate(planet: PlanetDraft | null, name: string): { template: MapTemplate; at: MacroCoord } {
  const n = PLANET_MAX_CELLS;
  const ground = Array.from({ length: n }, () => Array.from({ length: n }, (): CellZone => OFF_MAP_ZONE));
  const terrain = new Uint8Array(n * n);
  const water = new Uint8Array(n * n);
  let landmarks: LandmarkConfig[] = [];
  let at: MacroCoord = { x: 0, y: 0 };
  if (planet) {
    const t = planet.template;
    const under = groundUnderRim(t.zones, planet.rimSand);
    const ox = Math.floor((n - t.width) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    const oy = Math.floor((n - t.height) / 2 / CHUNK_SIZE) * CHUNK_SIZE;
    at = { x: ox, y: oy };
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
      ground[y + oy]![x + ox] = under[y]![x]!;
      terrain[(y + oy) * n + x + ox] = t.terrain?.[y * t.width + x] ?? 0;
      water[(y + oy) * n + x + ox] = t.water?.[y * t.width + x] ?? 0;
    }
    landmarks = t.landmarks.filter((l) => hasLandmark(l)).map((l) => ({ ...l, x: l.x + ox, y: l.y + oy }));
  }
  const template: MapTemplate = {
    id: `${PLANET_CANVAS_ID_PREFIX}${++canvasSessions}`,
    name: { en: name },
    width: n,
    height: n,
    zones: ground,
    landmarks,
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
    ...(review.unplaced?.length ? { unplaced: review.unplaced } : {}),
  };
}

/** Each editor's running shore follower, keyed by its event bus so two editors never stop each other's. */
const shoreFollowers = new WeakMap<object, () => void>();

/**
 * Keeps the canvas's shore rim derived while the session runs: after every cells change, sea and sand
 * near the changed cells are re-derived and the cells that changed are announced for the views. The
 * rim is not an edit, so it stays out of the history. Only commands change the ground under a rim
 * cell, and their cell snapshots carry it, so undo and redo re-derive the rim from the ground they
 * restore.
 */
function followShore(port: SessionPort): void {
  const bus = port.events();
  shoreFollowers.get(bus)?.();
  let deriving = false;
  const onCells = ({ cells }: { cells: readonly CellSet[] }) => {
    const state = sessionKit(port)?.state;
    // The rim depends on ground alone, so the cells it announces need no pass of their own.
    if (!state || deriving) return;
    const changed = refreshBoundary(state.cells, cellsOn(cells, TERRAIN_GRID));
    if (changed.length === 0) return;
    bumpCellsVersion(state);
    deriving = true;
    try { bus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, changed)] }); } finally { deriving = false; }
  };
  bus.on('cells-changed', onCells);
  shoreFollowers.set(bus, () => { bus.off('cells-changed', onCells); shoreFollowers.delete(bus); });
}

/**
 * Parks the live map with `cameras`, each view's camera as the caller read it, and opens `source` on
 * the scratch canvas: a saved entry, a draft opened as a new planet (one read from a scan), or a
 * blank sea for a new planet when null. No-op inside a session or before a map is loaded.
 */
export function enterPlanetSession(port: SessionPort, source: SessionEntry | PlanetDraft | null, cameras: ViewCameras = {}): void {
  if (port.planetSession()) return;
  const parked = port.park(cameras.view2d ?? null, cameras.view3d ?? null);
  if (!parked) return;
  const entry = source && isEntry(source) ? source : null;
  // An unreviewed name stays off the canvas, whose name any surface may show.
  const { template, at } = canvasTemplate(source, entry?.nameReviewed ? entry.name : '');
  const review = source && !entry ? canvasReview(source, at) : undefined;
  port.openPlanetCanvas(template, createPlanetRegistry(), {
    entryId: entry?.entryId ?? null,
    name: entry?.name ?? '',
    nameReviewed: entry?.nameReviewed ?? true,
    parked,
    ...(review ? { review } : {}),
  });
  // One full pass lays the rim on the installed ground, keeping the sand under it on the cells.
  const state = sessionKit(port)?.state;
  if (state) {
    const rim = refreshBoundary(state.cells, [], 0);
    if (rim.length > 0) {
      bumpCellsVersion(state);
      port.events().emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, rim)] });
    }
  }
  followShore(port);
}

/**
 * Reinstates the parked map by identity and returns the cameras it was parked with, for the caller to
 * queue for the views: null when none was read. No-op returning null outside a session.
 */
export function leavePlanetSession(port: SessionPort): ViewCameras | null {
  const session = port.planetSession();
  if (!session) return null;
  const { parked } = session;
  shoreFollowers.get(port.events())?.();
  port.endSession(parked);
  return parked.camera2d || parked.camera3d
    ? { ...(parked.camera2d ? { view2d: parked.camera2d } : {}), ...(parked.camera3d ? { view3d: parked.camera3d } : {}) }
    : null;
}

/** The whole chunks the canvas's ground and landmarks cover, or null when it has no ground. */
export function sessionFrame(state: GridState): PlanetFrame | null {
  return groundFrame(state.cells.map((row) => row.map(groundZone)), landmarkObjects(state));
}

/** A planet as the session saves it: the template and the sand its rim hides (`rimSandOf`). */
type SessionPlanet = PlanetCrop;

/** Whether the canvas holds any ground (grass or beach); the planet has none to save until it does. */
export function sessionHasGround(state: GridState | null): boolean {
  return !!state && sessionFrame(state) !== null;
}

/** Whether leaving `session` would lose work: an edit (an undo depth above 0), or a planet the
 *  session opened that is not saved yet (one read from a scan), which Back must not throw away unasked. */
export function sessionHasEdits(session: PlanetSession | null, historyDepth: number): boolean {
  return historyDepth > 0 || !!session?.review;
}

/** The landmarks a scan left `session` to place that the canvas `state` still lacks. */
export function pendingLandmarks(session: PlanetSession | null, state: GridState | null): string[] {
  return (session?.review?.unplaced ?? []).filter((id) => !state?.objects.has(id));
}

/**
 * The planet drawn on the canvas (`cropPlanet`): ground and landmarks cropped to their chunk frame, shore
 * derived from the ground under it, mountain elevations, water and the landmarks translated into the crop,
 * with the sand under the rim. Null when the canvas has no ground.
 */
export function sessionPlanet(state: GridState): SessionPlanet | null {
  const ground = state.cells.map((row) => row.map(groundZone));
  const cut = cropPlanet(ground, landmarkObjects(state), (x, y) => state.cells[y]?.[x]?.terrain, state.template.name.en ?? '');
  return cut && { template: cut.template, rimSand: cut.rimSand };
}

/** The session's planet named `name`; the session stays open so the caller can save before leaving. `empty` outside a session. */
export function finishPlanetSession(port: SessionPort, name: string): ({ ok: true } & SessionPlanet) | { ok: false; reason: 'empty' } {
  const state = sessionKit(port)?.state;
  const p = state ? sessionPlanet(state) : null;
  return p ? { ok: true, template: { ...p.template, name: { en: name } }, rimSand: p.rimSand } : { ok: false, reason: 'empty' };
}

/**
 * Whether `obj` turns through the session's footprint turn: a planet session is open, the object is
 * unlocked and its item declares `footprintTurn`. The one test every rotate entry point asks.
 */
export function turnsInSession(obj: PlacedObject | null | undefined, inSession: boolean): boolean {
  if (!obj || !inSession || obj.locked) return false;
  const item = getCatalogItem(obj.catalogId);
  return !!item && hasTrait(item, 'footprintTurn');
}

/** A session landmark edit's result; `cmd` is the placement it made or refused, for the caller's spin or toast. */
export type SessionLandmarkResult = ValidationResult & { cmd?: PlaceObjectCommand };

const NOT_IN_SESSION: SessionLandmarkResult = { success: false, errors: [] };

/** A commit's outcome: the post-stroke rules reverted the edit when they report violations. */
function committed(violations: ValidationError[], cmd?: PlaceObjectCommand): SessionLandmarkResult {
  return { success: violations.length === 0, errors: violations, ...(cmd ? { cmd } : {}) };
}

/** The live editor while a planet session is open. */
function sessionKit(port: SessionPort) {
  return port.planetSession() ? port.live() : null;
}

/**
 * Turns session landmark `id` (the anchor's by default) by `quarterTurns` signed quarters, clockwise
 * positive as `rotateGroup` reads them, about its centre as one undo step (remove and place). The turned footprint is validated before anything moves,
 * so a refusal leaves the landmark as it was.
 */
export function rotateSessionLandmark(
  port: SessionPort, quarterTurns: QuarterTurn | 2 = 1, id: string | undefined = ANCHOR_LANDMARK?.id,
): SessionLandmarkResult {
  const kit = sessionKit(port);
  const landmark = id === undefined ? undefined : kit?.state.objects.get(id);
  if (!kit || !landmark || !turnsInSession(landmark, true)) return NOT_IN_SESSION;
  let turned = landmark;
  for (let i = 0; i < (quarterTurns + 4) % 4; i++) turned = turnedLandmark(turned);
  const { cmd, errors } = planObjectPlacement(kit.executor, kit.state, landmark, turned);
  if (errors.length > 0) return { success: false, errors, cmd };
  return kit.executor.transaction({}, (tx): SessionLandmarkResult => {
    kit.executor.execute(removeObjectCommand(landmark));
    const res = kit.executor.execute(cmd);
    if (!res.success) {
      tx.rollback();
      return { ...res, cmd };
    }
    return committed(tx.commit(), cmd);
  });
}
