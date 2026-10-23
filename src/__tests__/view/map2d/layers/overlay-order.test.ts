// @vitest-environment jsdom
/** The 2D overlay paints in one fixed order whatever is shown first, with the error flash on top. */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { cellSet, evidenceOn } from '../../../../core/grid/grids';

const SHOWS: Array<(o: OverlayLayer) => void> = [
  (o) => o.showBuildableRegion(cellSet('terrain', [{ x: 2, y: 2 }]), 1),
  (o) => o.showPath(cellSet('terrain', [{ x: 3, y: 3 }])),
  (o) => o.showCellMarks(cellSet('terrain', [{ x: 4, y: 4 }]), null),
  (o) => o.showFlaggedObjects([{ id: 'f', catalogId: 'tree-apple', position: { x: 7, y: 7 }, rotation: 0, elevation: 0 }]),
  (o) => o.showPlacementGhost({ catalogId: 'tree-apple', x: 5, y: 5, rotation: 0, elevation: 0 }, false),
  (o) => o.showGroupPlacementGhost([{ catalogId: 'tree-apple', x: 6, y: 6, rotation: 0, elevation: 0 }], true),
  (o) => o.showSelection({ x: 1, y: 1, w: 1, h: 1 }, 'object', { elevation: 2 }),
  (o) => o.showNoteGhost({ kind: 'measure', id: 'g', points: [{ x: 1, y: 1 }, { x: 1, y: 1 }], color: '#ffffff' }, ''),
];

/** A refusal on one terrain cell. */
const refusal = { ruleId: 'T', message: 'test', ...evidenceOn('terrain', [{ x: 3, y: 3 }]) };

const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

/** Each child's place in the paint order the layer was built with; -1 for one added since. */
const builtOrder = (overlay: OverlayLayer, built: readonly PIXI.DisplayObject[]): number[] =>
  overlay.container.children.map((child) => built.indexOf(child));

describe('the 2D overlay paint order', () => {
  it('holds whatever is shown first', () => {
    const forward = new OverlayLayer(() => {}), backward = new OverlayLayer(() => {});
    const forwardBuilt = [...forward.container.children], backwardBuilt = [...backward.container.children];
    for (const show of SHOWS) show(forward);
    for (const show of [...SHOWS].reverse()) show(backward);
    expect(builtOrder(forward, forwardBuilt)).toEqual(forwardBuilt.map((_, i) => i));
    expect(builtOrder(backward, backwardBuilt)).toEqual(backwardBuilt.map((_, i) => i));
  });

  it('paints the error flash on top of every other part', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.flashErrors([refusal]);
    await frame();
    const drawing = overlay.container.children
      .map((child, i) => (child instanceof PIXI.Graphics && child.geometry.graphicsData.length > 0 ? i : -1))
      .filter((i) => i >= 0);
    expect(drawing).toEqual([overlay.container.children.length - 1]);
  });
});
