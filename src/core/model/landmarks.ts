/* The game's fixed structures on a map: the objects a template lays, their footprints and the ground they stand on. */
import { ANCHOR_LANDMARK, GRIDS, LANDMARKS, PLACEMENT_GRID, landmarkSpec, type LandmarkSpec } from '../game/profile';
import { isGrassZone, isSeaZone, type CellZone } from '../game/zones';
import { footprintCells, getRotatedSize } from '../grid/footprint';
import { gridCellsUnderRect } from '../grid/grids';
import { snapHalf } from '../grid/rect';
import { turnRotation, type GridState, type LandmarkConfig, type MacroCoord, type MapTemplate, type PlacedObject, type Rotation } from './types';

/** Whether a landmark config or object lays a footprint; a zero width or height, or none at all,
 *  stands for none. */
export function hasLandmark<T extends { width?: number; height?: number }>(p: T | null | undefined): p is T & { width: number; height: number } {
  return !!p && (p.width ?? 0) > 0 && (p.height ?? 0) > 0;
}

/** The anchor landmark's object on `state`: the one two planets are laid over each other by. */
export function templateLandmark(state: Pick<GridState, 'objects'>): PlacedObject | undefined {
  return ANCHOR_LANDMARK && state.objects.get(ANCHOR_LANDMARK.id);
}

/** Every landmark object on `state`, in profile order. */
export function landmarkObjects(state: Pick<GridState, 'objects'>): PlacedObject[] {
  const out: PlacedObject[] = [];
  for (const spec of LANDMARKS) {
    const o = state.objects.get(spec.id);
    if (o) out.push(o);
  }
  return out;
}

/** Whether `id` names a landmark: its item id, which is also its object id on every map. */
export function isLandmarkItem(id: string): boolean {
  return landmarkSpec(id) !== undefined;
}

/** Whether `o` is a landmark its map lays from the template: locked, and its item a landmark. The
 *  planet session's landmarks are unlocked, since that editor moves them. */
export function isLaidLandmark(o: Pick<PlacedObject, 'locked' | 'catalogId'>): boolean {
  return o.locked === true && isLandmarkItem(o.catalogId);
}

/** The object-grid cells the laid landmarks on `state` cover, part-covered cells included
 *  (`footprintCells`), landmark by landmark in profile order. Cells off the map are not dropped. */
export function landmarkCells(state: Pick<GridState, 'objects'>): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const o of landmarkObjects(state)) {
    if (isLaidLandmark(o) && hasLandmark(o)) out.push(...footprintCells(o.position.x, o.position.y, o.width, o.height));
  }
  return out;
}

/** The anchor landmark's config in `t`, or undefined when it lays none or the game has no anchor. */
export function templateAnchor(t: Pick<MapTemplate, 'landmarks'>): LandmarkConfig | undefined {
  const id = ANCHOR_LANDMARK?.id;
  return id === undefined ? undefined : t.landmarks.find((l) => l.id === id);
}

/** The landmark object `p` lays. Self-described (size, an icon its item lacks, colour), so every
 *  landmark renders through the normal object path with no special-case renderer. It carries no
 *  height: like any object it stands on the ground under it (`state/object-geometry.ts:objectElevation`). */
function landmarkObject(p: LandmarkConfig, locked: boolean): PlacedObject {
  const icon = landmarkSpec(p.id)?.icon;
  return {
    id: p.id, catalogId: p.id,
    position: { x: p.x, y: p.y }, width: p.width, height: p.height,
    ...(icon ? { icon } : {}), ...(p.color !== undefined ? { color: p.color } : {}),
    rotation: p.rotation ?? 0, elevation: 0, locked,
  };
}

/** The locked landmark objects a template lays, in profile order. Added to the grid's objects at init
 *  and load and excluded from serialization. */
export function templateLandmarkObjects(template: Pick<MapTemplate, 'landmarks'>): PlacedObject[] {
  return template.landmarks.filter((p) => hasLandmark(p) && landmarkSpec(p.id)).map((p) => landmarkObject(p, true));
}

/** The landmark objects among `objects` with a footprint, one of each, in profile order. */
export function landmarksOf(objects: readonly PlacedObject[]): PlacedObject[] {
  return LANDMARKS.flatMap((spec) => objects.filter((o) => o.id === spec.id && hasLandmark(o)).slice(0, 1));
}

/** The template landmark `landmark` stands as, measured from `origin`: the inverse of
 *  `landmarkObject` for a planet cut out of a larger canvas. */
export function landmarkConfig(landmark: PlacedObject, origin: MacroCoord = { x: 0, y: 0 }): LandmarkConfig {
  return {
    id: landmark.id,
    x: landmark.position.x - origin.x, y: landmark.position.y - origin.y,
    width: landmark.width ?? 0, height: landmark.height ?? 0,
    ...(landmark.rotation ? { rotation: landmark.rotation } : {}),
  };
}

/** An unlocked `spec` landmark with its top-left at `at`, at the profile's footprint; width and
 *  height are the laid footprint for `rotation`. */
export function planetLandmarkObject(spec: LandmarkSpec, at: MacroCoord, rotation: Rotation): PlacedObject {
  const { w: width, h: height } = getRotatedSize(spec, rotation);
  return landmarkObject({ id: spec.id, x: at.x, y: at.y, width, height, rotation }, false);
}

/** `landmark` a quarter turn clockwise: footprint swapped about the same centre, anchored on the half-cell grid. */
export function turnedLandmark(landmark: PlacedObject): PlacedObject {
  const w = landmark.width ?? 0, h = landmark.height ?? 0;
  return {
    ...landmark,
    position: { x: snapHalf(landmark.position.x + (w - h) / 2), y: snapHalf(landmark.position.y + (h - w) / 2) },
    width: h, height: w,
    rotation: turnRotation(landmark.rotation, 1),
  };
}

/** Whether `zone` reads as sea; a cell outside the zones does. */
const seaZone = (zone: CellZone | undefined): boolean => zone === undefined || isSeaZone(zone);

/**
 * Whether the cells `zoneAt` reads under the laid footprint `rect`, turned by `rotation`, are the
 * ground `spec` stands on (`LandmarkGround`). `zoneAt` answers undefined outside the grid, which reads
 * as open sea; a template passes its stored zones, whose shore rim reads as sea, and the planet session
 * each cell's own ground.
 */
export function landmarkGroundHolds(
  spec: Pick<LandmarkSpec, 'ground'>, rect: { x: number; y: number; width: number; height: number }, rotation: Rotation,
  zoneAt: (x: number, y: number) => CellZone | undefined,
): boolean {
  const under = gridCellsUnderRect(GRIDS[PLACEMENT_GRID], { x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  const x0 = under.x, y0 = under.y, x1 = under.x + under.w - 1, y1 = under.y + under.h - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const z = zoneAt(x, y);
    const grass = z !== undefined && isGrassZone(z);
    if (grass !== (spec.ground === 'grass')) return false;
  }
  if (spec.ground === 'grass') return true;
  // The landward edge is the unturned north edge, turned clockwise with the footprint.
  const edge = (side: Rotation): (CellZone | undefined)[] => {
    const out: (CellZone | undefined)[] = [];
    if (side === 0) for (let x = x0; x <= x1; x++) out.push(zoneAt(x, y0));
    else if (side === 90) for (let y = y0; y <= y1; y++) out.push(zoneAt(x1, y));
    else if (side === 180) for (let x = x0; x <= x1; x++) out.push(zoneAt(x, y1));
    else for (let y = y0; y <= y1; y++) out.push(zoneAt(x0, y));
    return out;
  };
  return edge(rotation).some((z) => !seaZone(z)) && edge(turnRotation(rotation, 2)).every(seaZone);
}

/** A reader of `zones` for `landmarkGroundHolds`. */
export function zonesReader(zones: readonly (readonly CellZone[])[]): (x: number, y: number) => CellZone | undefined {
  return (x, y) => zones[y]?.[x];
}
