/*
 * How a placed object's picture sits on the 2D map, as pure arithmetic: which art it draws, where
 * its centre stands, how it turns and how large it draws. The object layer and every 2D ghost pose
 * their sprite from this one answer, so a ghost shows the picture the placement leaves.
 *
 * Pixi-free, so a caller that only needs the url (a capture's decode list, a browser rig) can ask
 * without loading the renderer.
 */
import type { PlacedObject } from '../../../core/model/types';
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { iconUrl } from '../../../assets/icon-urls';
import { isBridge, isRamp, isSurfacePrint } from '../../../core/model/traits';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { isQuarterTurn } from '../../../core/grid/footprint';
import { TILE_SIZE } from '../geometry/world';

/** The sprite url `obj` draws with: its own variant icon, or the item's — except a color-carrying
 *  non-ramp item, whose body is drawn as geometry rather than a sprite. */
export function objectSpriteUrl(obj: PlacedObject, item: CatalogEntry | undefined): string | undefined {
  const name = obj.icon ?? (isRamp(item) || !item?.color ? item?.icon : undefined);
  return name ? iconUrl(name) : undefined;
}

/**
 * Whether an item's icon turns with the placement's rotation: a rotatable item because the user
 * turned it, and a bridge because it lies along the gap it crosses.
 */
function spriteTurns(item: CatalogEntry | undefined): boolean {
  return !!item && (item.rotatable || isBridge(item));
}

/** Sprite size relative to the object footprint: catalog art carries transparent margin, so a
 *  small overshoot makes the drawn thing read at the size of its cells. */
const SPRITE_FILL = 1.1;

/** The share of a ramp footprint's short side its badge spans. */
const RAMP_BADGE = 0.8;

/**
 * How to turn the ramp's icon so the art climbs the way the ramp does.
 *
 * Every ramp is drawn the same way: low on the left, high on the right. A ramp that climbs the
 * other way is the same picture mirrored — not turned upside down, which is what a half turn would
 * give. The two vertical directions are quarter turns of it. Uphill by rotation: 0 north, 90 west,
 * 180 south, 270 east.
 */
export function rampIconTurn(rotation: number): { rotation: number; flipX: boolean } {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { rotation: 0, flipX: true };              // uphill west — mirrored
    case 0: return { rotation: -Math.PI / 2, flipX: false };   // uphill north
    case 180: return { rotation: Math.PI / 2, flipX: false };  // uphill south
    default: return { rotation: 0, flipX: false };             // uphill east — the art as drawn
  }
}

/** What a picture is drawn from: an icon image, or a surface print's art. */
export type SpriteArt =
  | { kind: 'icon'; url: string }
  | { kind: 'print'; pattern: NonNullable<CatalogEntry['surfacePrint']> };

/** One object's picture on the 2D map. */
export interface SpritePose {
  art: SpriteArt;
  /** The picture's centre, in world px from the object's corner. */
  x: number;
  y: number;
  /** Its turn in radians, and whether it is mirrored across its own vertical axis. */
  rotation: number;
  flipX: boolean;
  /** The scale on each axis, unsigned, for art of `tw` by `th` texture px. */
  scale(tw: number, th: number): { x: number; y: number };
}

/**
 * The picture `obj` draws, or null when it draws none (a road, whose surface draws it). A print is
 * stretched over its footprint, a ramp's icon is a badge on its short side, and any other icon is
 * contained in its footprint at one scale on both axes. Art that turns a quarter with the object is
 * fitted to the footprint turned back, so a turn never resizes the picture (a turn's frames swing the
 * landed picture back through the poses before it).
 */
export function objectSpritePose(
  obj: PlacedObject, item: CatalogEntry | undefined, size: { w: number; h: number } = getPlacedObjectSize(obj, item),
): SpritePose | null {
  const fw = size.w * TILE_SIZE, fh = size.h * TILE_SIZE;
  const at = { x: fw / 2, y: fh / 2 };
  const objTurn = (obj.rotation * Math.PI) / 180;
  /** The footprint in the art's own frame: art turned a quarter lies across it. */
  const box = (turns: boolean) => (turns && isQuarterTurn(obj.rotation) ? { bw: fh, bh: fw } : { bw: fw, bh: fh });
  const print = isSurfacePrint(item) ? item?.surfacePrint : undefined;
  if (print) {
    const { bw, bh } = box(true);
    return { art: { kind: 'print', pattern: print }, ...at, rotation: objTurn, flipX: false, scale: (tw, th) => ({ x: bw / tw, y: bh / th }) };
  }
  const url = objectSpriteUrl(obj, item);
  if (!url) return null;
  const art = { kind: 'icon', url } as const;
  if (isRamp(item)) {
    const badge = Math.min(fw, fh) * RAMP_BADGE;
    const uniform = (tw: number, th: number) => { const s = badge / Math.max(tw, th); return { x: s, y: s }; };
    return { art, ...at, ...rampIconTurn(obj.rotation), scale: uniform };
  }
  const turns = spriteTurns(item);
  const { bw, bh } = box(turns);
  // A self-described object (a landmark) carries a filled platform image, contained within its box.
  const fill = obj.icon || item?.artInFootprint ? 1 : SPRITE_FILL;
  const contain = (tw: number, th: number) => { const s = Math.min(bw / tw, bh / th) * fill; return { x: s, y: s }; };
  return { art, ...at, rotation: turns ? objTurn : 0, flipX: false, scale: contain };
}
