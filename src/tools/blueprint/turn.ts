/* Turn a blueprint body clockwise by quarter turns, or mirror it left to right, inside its own frame. */
import { turnRotation, type Orientation } from '../../core/base/coords';
import { mirrorCorners, turnCorners } from '../../core/model/corners';
import type { BlueprintBody, BlueprintCell, BlueprintObject } from '../../core/model/blueprint';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { hasTrait, isBridge, isRamp } from '../../core/model/traits';
import type { CatalogItem, Rotation } from '../../core/model/types';
import { turnBridgeRotation } from '../../core/domain/terrain/bridge-span';
import { turnRampRotation } from '../../core/domain/terrain/ramp-span';
import { mirrorExits, rotateExits } from '../../core/grid/directions';

/** `body` turned `quarters` clockwise quarter turns (taken mod 4, negative counts turn back): the
 *  frame's width and height trade, each cell and object moves with it, and corner trims, facings and
 *  spans turn with what carries them. */
export function turnBody(body: BlueprintBody, quarters: number): BlueprintBody {
  let out = body;
  for (let q = ((quarters % 4) + 4) % 4; q > 0; q--) out = quarterTurn(out);
  return out;
}

function quarterTurn(body: BlueprintBody): BlueprintBody {
  // The cell grid is (w + 1) by (h + 1) and centred on the frame, so cell (i, j) lands at (h - j, i).
  const cw = body.w + 1, ch = body.h + 1;
  const cells: (BlueprintCell | null)[] = new Array<BlueprintCell | null>(cw * ch).fill(null);
  body.cells.forEach((c, k) => {
    const i = k % cw, j = Math.floor(k / cw);
    cells[i * ch + (ch - 1 - j)] = c && (c.corners ? { ...c, corners: turnCorners(c.corners, 1) } : c);
  });
  return { w: body.h, h: body.w, cells, objects: body.objects.map((o) => turnObject(o, body.h)) };
}

/** `body` laid at orientation `o` inside its own frame: mirrored left to right first, then turned. */
export function orientBody(body: BlueprintBody, o: Orientation): BlueprintBody {
  return turnBody(o.mirror ? mirrorBody(body) : body, o.quarters);
}

/** `body` mirrored left to right inside its frame: each terrain column trades places with its mirror,
 *  corner cuts mirrored with it, and each object's footprint moves to its mirror, its facing turned to
 *  the mirrored side (`mirroredFacing`), since the game never mirrors an item's art. */
function mirrorBody(body: BlueprintBody): BlueprintBody {
  const cw = body.w + 1;
  const cells = body.cells.map((_, k) => {
    const c = body.cells[k - (k % cw) + (cw - 1 - (k % cw))] ?? null;
    return c && (c.corners ? { ...c, corners: mirrorCorners(c.corners) } : c);
  });
  return { w: body.w, h: body.h, cells, objects: body.objects.map((o) => mirrorObject(o, body.w)) };
}

function mirrorObject(o: BlueprintObject, frameW: number): BlueprintObject {
  const item = getCatalogItem(o.catalogId);
  const { w } = getPlacedObjectSize(
    { id: '', catalogId: o.catalogId, position: { x: o.x, y: o.y }, rotation: o.rotation, elevation: 0, spanLength: o.spanLength },
    item,
  );
  return {
    ...o,
    x: frameW - o.x - w,
    rotation: mirroredFacing(o.rotation, item),
    ...(o.corners ? { corners: mirrorCorners(o.corners) } : null),
  };
}

/**
 * The facing an item takes when what it stands in is mirrored left to right. A bridge's rotation
 * names only the axis it spans, which a mirror keeps. A print with centreline exits takes the turn
 * whose exits are the mirror of its own. Otherwise a facing is a side: a ramp's downhill side, a
 * rotatable item's front (a house's door) and a footprint-turning landmark's landward edge all lie
 * along y at rotation 0, so the mirror negates the angle, keeping the footprint's width and height.
 * Any other item keeps its facing, as a turn carries it.
 */
function mirroredFacing(rotation: Rotation, item: CatalogItem | undefined): Rotation {
  if (!item || isBridge(item)) return rotation;
  const negated = turnRotation(0, -rotation / 90);
  if (item.strokeConnections && item.rotatable) return mirroredExits(rotation, negated, item.strokeConnections, item.width === item.height);
  return isRamp(item) || item.rotatable || hasTrait(item, 'footprintTurn') ? negated : rotation;
}

/** The turn of a print whose exits at rotation 0 are `exits` that shows the mirror of what it shows
 *  at `rotation`: `negated` when that does, else the first that does, keeping the footprint's width
 *  and height unless it is square. */
function mirroredExits(rotation: Rotation, negated: Rotation, exits: number, square: boolean): Rotation {
  const want = mirrorExits(rotateExits(exits, rotation / 90));
  const shows = (r: Rotation): boolean => rotateExits(exits, r / 90) === want;
  if (shows(negated)) return negated;
  const found = ([0, 90, 180, 270] as const).find((r) => shows(r) && (square || r % 180 === rotation % 180));
  return found ?? negated;
}

/** The facing an item takes when what it stands in takes orientation `o`: mirrored first, then turned. */
export function orientedFacing(rotation: Rotation, item: CatalogItem | undefined, o: Orientation): Rotation {
  let out = o.mirror ? mirroredFacing(rotation, item) : rotation;
  for (let q = ((o.quarters % 4) + 4) % 4; q > 0; q--) out = turnedFacing(out, item);
  return out;
}

/** `o` after its frame, `frameH` cells tall, turns a quarter clockwise. Its footprint turns whole,
 *  so its top-left anchor shifts by its own height. A facing turns where it means something: a
 *  rotatable item clockwise, a bridge's span axis and a ramp's downhill side as their own rotations
 *  read them. Any other item, an unknown one included, keeps its facing, as a group rotation carries it. */
function turnObject(o: BlueprintObject, frameH: number): BlueprintObject {
  const item = getCatalogItem(o.catalogId);
  const { h } = getPlacedObjectSize(
    { id: '', catalogId: o.catalogId, position: { x: o.x, y: o.y }, rotation: o.rotation, elevation: 0, spanLength: o.spanLength },
    item,
  );
  return {
    ...o,
    x: frameH - o.y - h,
    y: o.x,
    rotation: turnedFacing(o.rotation, item),
    ...(o.corners ? { corners: turnCorners(o.corners, 1) } : null),
  };
}

function turnedFacing(rotation: Rotation, item: CatalogItem | undefined): Rotation {
  if (!item) return rotation;
  if (isRamp(item)) return turnRampRotation(rotation);
  if (isBridge(item)) return turnBridgeRotation(rotation);
  return item.rotatable ? turnRotation(rotation, 1) : rotation;
}
