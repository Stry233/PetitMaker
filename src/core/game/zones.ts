import { CellZone, ZONE_ID_BITS, ZONES, type GroundZone, type SandZone, type ZoneSpec } from './profile';

export { CellZone, type GroundZone, type SandZone } from './profile';

const SPECS = ZONES as Readonly<Partial<Record<number, ZoneSpec>>>;

/** The traits of `zone`, or undefined for a value that names none. */
export function zoneSpec(zone: number | undefined): ZoneSpec | undefined {
  return zone === undefined ? undefined : SPECS[zone];
}

// The predicates run per cell in every sweep, so each trait is read once into a table by zone id.
const ZONE_ID_LIMIT = 1 << ZONE_ID_BITS;
const traitTable = (trait: (spec: ZoneSpec) => boolean): Uint8Array =>
  Uint8Array.from({ length: ZONE_ID_LIMIT }, (_, id) => (SPECS[id] && trait(SPECS[id]!) ? 1 : 0));
const BUILDABLE = traitTable((s) => s.buildable);
const SEA = traitTable((s) => s.sea);
const OPEN_SEA = traitTable((s) => s.sea && !s.rim);
const RIM = traitTable((s) => s.rim);
const LAND = traitTable((s) => s.land);
const SHORE_SOURCE = traitTable((s) => s.shoreSource);

/** The one zone whose spec has `trait`; the profile declares exactly one. */
function onlyZone(trait: (spec: ZoneSpec) => boolean): CellZone {
  const ids = Object.keys(SPECS).map(Number).filter((id) => trait(SPECS[id]!));
  if (ids.length !== 1) throw new Error(`zones: ${ids.length} zones carry a trait exactly one must`);
  return ids[0] as CellZone;
}

/** `onlyZone` for a zone terrain commands write as a cell's ground; the profile marks it writable. */
function onlyGroundZone(trait: (spec: ZoneSpec) => boolean): GroundZone {
  const zone = onlyZone(trait);
  if (!SPECS[zone]!.writable) throw new Error(`zones: zone ${zone} must be writable`);
  return zone as GroundZone;
}

/** The zone a cell beyond the map reads as and a fresh planet canvas holds. */
export const OFF_MAP_ZONE: GroundZone = onlyGroundZone((s) => s.offMap);
/** The derived shore rim's zone. */
export const RIM_ZONE: CellZone = onlyZone((s) => s.rim);
/** The ground a rim cell keeps under it (`MacroCell.under`). */
export const SAND_ZONE = onlyZone((s) => s.sand) as SandZone;
/** The ground a shore rim forms around, which the layer-0 edits paint land as. */
export const GRASS_ZONE: GroundZone = onlyGroundZone((s) => s.shoreSource);

/** Whether a zone can be built, placed and painted on. */
export function isBuildableZone(zone: CellZone | undefined): boolean {
  return zone !== undefined && BUILDABLE[zone] === 1;
}

/** Open sea, or a shore rim read from a zone alone, where the ground under it is unknown. A cell's
 *  own ground is `groundZone`. */
export function isSeaZone(zone: CellZone): boolean {
  return SEA[zone] === 1;
}

/** Open sea: sea that is no shore rim. */
export function isOpenSeaZone(zone: CellZone): boolean {
  return OPEN_SEA[zone] === 1;
}

/** The derived shore rim. */
export function isRimZone(zone: CellZone | undefined): boolean {
  return zone !== undefined && RIM[zone] === 1;
}

/** Land the layer-0 edits turn to and from sea. */
export function isLandZone(zone: CellZone): boolean {
  return LAND[zone] === 1;
}

/** The ground a shore rim forms around and a `grass` landmark stands on. */
export function isGrassZone(zone: CellZone): boolean {
  return SHORE_SOURCE[zone] === 1;
}

/** The shore's sand: the one ground a rim cell keeps under it. */
export function isSandZone(zone: unknown): zone is SandZone {
  return zone === SAND_ZONE;
}

/** Whether `v` names a zone a terrain command may write as a cell's ground. */
export function isGroundZone(v: unknown): boolean {
  return isCellZone(v) && SPECS[v]!.writable;
}

/** The ground a cell stands on: a shore rim cell's own sand or sea, any other cell's zone. Layer 0
 *  edits read this, so a rim cell behaves as the ground under it. */
export function groundZone(cell: { readonly zone: CellZone; readonly under?: SandZone }): CellZone {
  return isRimZone(cell.zone) ? cell.under ?? OFF_MAP_ZONE : cell.zone;
}

/** Whether `v` names a zone. */
export function isCellZone(v: unknown): v is CellZone {
  return typeof v === 'number' && Number.isInteger(v) && SPECS[v] !== undefined;
}
