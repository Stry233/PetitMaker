// @vitest-environment jsdom
/**
 * The 2D ghost of an object draws its picture in the box the placed object draws it in: the same
 * size, centre, turn and mirror, for every catalog item at every turn, through every ghost that
 * shows bodies (the hover ghost, a drag-to-move, and the group ghost a paste, a blueprint and Paint
 * show); and that picture keeps its size when the item turns.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, beforeAll } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { spec } from '../../../_support/spec';
import { ObjectLayer } from '../../../../view/map2d/layers/object-layer';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { overlayPart } from '../../../_support/overlay-parts';
import { getKnownItems, landmarkItems } from '../../../../state/catalog';
import { ghostParts } from '../../../../tools/pointer/runtime/placement-ghost';
import { allIconUrls } from '../../../../assets/icon-urls';
import { hasTrait } from '../../../../core/model/traits';
import type { PlacedObject, PlacementTrait, Rotation } from '../../../../core/model/types';
import type { CatalogEntry } from '../../../../config/catalog/catalog-entry';

const TURNS: readonly Rotation[] = [0, 90, 180, 270];

/** Every icon decodes at one size that is not square, so a stretched or turned fit cannot hide. */
beforeAll(() => {
  for (const url of allIconUrls()) PIXI.Texture.from(url).baseTexture.setRealSize(300, 200);
});

/** The object an item lays at a half-cell corner, turned `rotation`: a bridge with the span it
 *  snaps, a landmark self-described as its template lays it. */
function placed(item: CatalogEntry, rotation: Rotation): PlacedObject {
  const span = item.traits.find((t): t is Extract<PlacementTrait, { type: 'waterSpan' }> => t.type === 'waterSpan');
  const landmark = landmarkItems().includes(item);
  return {
    id: `${item.id}@${rotation}`, catalogId: item.id, position: { x: 10.5, y: 12 }, rotation, elevation: 1,
    ...(span ? { spanLength: span.min + 2 } : null),
    ...(landmark ? { width: item.width, height: item.height, ...(item.icon ? { icon: item.icon } : null) } : null),
  };
}

type Corners = number[] | null;

/** The four corners of `sprite`'s texture in world px, in texture order (so a mirror or a turn shows),
 *  or null when it draws nothing. */
function corners(sprite: PIXI.Sprite | undefined): Corners {
  if (!sprite || !sprite.visible) return null;
  sprite.getBounds(); // brings the world transform up to date
  const { width: w, height: h } = sprite.texture.orig;
  const x0 = -sprite.anchor.x * w, y0 = -sprite.anchor.y * h;
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]
    .flatMap(([x, y]) => { const p = sprite.worldTransform.apply(new PIXI.Point(x, y)); return [p.x, p.y]; })
    .map((v) => Math.round(v * 1000) / 1000);
}

/** The picture the placed object draws: the one sprite of its wrapper that is not a label. */
function placedCorners(obj: PlacedObject): Corners {
  const layer = new ObjectLayer({ state: () => null, requestRender: () => {} });
  layer.addObjects([obj]);
  const wrapper = (layer as unknown as { objectMap: Map<string, PIXI.Container> }).objectMap.get(obj.id)!;
  const art = wrapper.children.filter((c): c is PIXI.Sprite => c instanceof PIXI.Sprite && !(c instanceof PIXI.Text));
  expect(art.length, `${obj.id} draws one picture at most`).toBeLessThanOrEqual(1);
  return corners(art[0]);
}

const hoverSprite = (overlay: OverlayLayer) => overlayPart<PIXI.Sprite | null>(overlay, 'placementGhost') ?? undefined;
const groupSprites = (overlay: OverlayLayer) => overlayPart<PIXI.Sprite[]>(overlay, 'groupGhosts');

/** Each ghost's picture of `obj`, by the ghost that drew it. */
function ghostCorners(obj: PlacedObject): Record<string, Corners> {
  const out: Record<string, Corners> = {};
  // A hover, a paste, a blueprint and Paint describe their bodies as placement ghosts; a landmark
  // never reaches them (its hover shows its outline, and no copy carries one).
  const [member] = ghostParts([obj]).members;
  if (obj.width === undefined) {
    const hover = new OverlayLayer(() => {});
    if (member) hover.showPlacementGhost(member, true);
    out.hover = corners(hoverSprite(hover));
    const group = new OverlayLayer(() => {});
    group.showGroupPlacementGhost(member ? [member, member] : [], true);
    out.group = corners(groupSprites(group)[0]);
  }
  const move = new OverlayLayer(() => {});
  move.showObjectMove([obj], true);
  out.move = corners(hoverSprite(move));
  const groupMove = new OverlayLayer(() => {});
  groupMove.showObjectMove([obj, obj], true);
  out.groupMove = corners(groupSprites(groupMove)[0]);
  return out;
}

const cases = [...getKnownItems()].flatMap((item) => TURNS.map((rotation) => placed(item, rotation)));

describe('the 2D ghost picture', () => {
  spec('UI-69', 'stands in the box the placed object draws its picture in, for every item and turn', () => {
    const diverged: string[] = [];
    for (const obj of cases) {
      const want = placedCorners(obj);
      for (const [ghost, got] of Object.entries(ghostCorners(obj))) {
        if (JSON.stringify(got) !== JSON.stringify(want)) diverged.push(`${obj.id} ${ghost}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      }
    }
    expect(diverged).toEqual([]);
  });

  it('is one size at every quarter turn, as the placed picture is, so a turn never jumps', () => {
    // A turn swings the landed picture back through the poses before it (`object-animations.ts`).
    const side = (c: number[], i: number) => Math.round(Math.hypot(c[i]! - c[0]!, c[i + 1]! - c[1]!) * 1000) / 1000;
    const size = (c: Corners) => c && [side(c, 2), side(c, 6)];
    const changed: string[] = [];
    for (const item of getKnownItems()) {
      if (!item.rotatable && !hasTrait(item, 'waterSpan')) continue;
      const sizes = TURNS.map((r) => JSON.stringify(size(placedCorners(placed(item, r)))));
      if (new Set(sizes).size > 1) changed.push(`${item.id}: ${sizes.join(' ')}`);
    }
    expect(changed).toEqual([]);
  });
});
