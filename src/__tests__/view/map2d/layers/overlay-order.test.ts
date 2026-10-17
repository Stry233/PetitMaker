// @vitest-environment jsdom
/** The 2D overlay paints in one fixed order whatever is shown first, with the error flash on top. */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { cellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

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

const PARTS = [
  'buildableGraphics', 'routeGraphics', 'reviewGraphics', 'planetFrameGraphics', 'planetFrameFlash',
  'washGraphics', 'spriteSlot', 'edgeGraphics', 'commitGraphics',
  'curveGraphics', 'ghostGraphics', 'previewIcon', 'noteSlot', 'hoverGraphics', 'bandGraphics', 'selectionGraphics', 'selectionFrame',
  'dimensionSlot', 'placementSlot', 'groupSlot', 'labelSlot', 'errorGraphics',
];

const slots = (overlay: OverlayLayer): number[] =>
  PARTS.map((field) => overlay.container.children.indexOf(overlayPart(overlay, field)));

describe('the 2D overlay paint order', () => {
  it('holds whatever is shown first, with the error flash on top', () => {
    const forward = new OverlayLayer(() => {}), backward = new OverlayLayer(() => {});
    for (const show of SHOWS) show(forward);
    for (const show of [...SHOWS].reverse()) show(backward);
    const expected = PARTS.map((_, i) => i);
    expect(slots(forward)).toEqual(expected);
    expect(slots(backward)).toEqual(expected);
    expect(forward.container.children).toHaveLength(PARTS.length);
  });
});
