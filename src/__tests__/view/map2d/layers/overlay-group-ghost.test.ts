// @vitest-environment jsdom
/**
 * OverlayLayer.showGroupPlacementGhost, the 2D group drag ghost (group-drag-ghost.test.tsx covers the
 * pointer wiring): a sprite per member sharing one validity tint, from a pool resized across calls
 * rather than rebuilt on every pointer move.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { overlayPart } from '../../../_support/overlay-parts';
import { GHOST_LOSS } from '../../../../view/shared/viewport/view-constants';
import { lerpColor } from '../../../../core/base/color';

type Sprite = {
  visible: boolean; tint: number; scale: { x: number; y: number };
  texture: { baseTexture: { setRealSize: (w: number, h: number) => void } };
};

function ghosts(overlay: OverlayLayer): Sprite[] {
  return overlayPart<Sprite[]>(overlay, 'groupGhosts');
}

/**
 * Mark every ghost's icon decoded and repaint: the sprite fit waits on decode, which jsdom never does.
 * The size is not square, since a square icon in a 1x1 footprint would hide a stretch to the box.
 */
function decodeIcons(overlay: OverlayLayer, repaint: () => void): void {
  for (const s of ghosts(overlay)) s.texture.baseTexture.setRealSize(64, 32);
  repaint();
}

describe('OverlayLayer group placement ghost', () => {
  it('draws one sprite per member, all sharing the SAME validity tint', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGroupPlacementGhost(
      [
        { catalogId: 'tree-apple', x: 5, y: 5, rotation: 0, elevation: 0 },
        { catalogId: 'tree-apple', x: 6, y: 5, rotation: 0, elevation: 0 },
        { catalogId: 'tree-apple', x: 7, y: 5, rotation: 0, elevation: 0 },
      ],
      true,
    );
    const members = [
      { catalogId: 'tree-apple', x: 5, y: 5, rotation: 0, elevation: 0 },
      { catalogId: 'tree-apple', x: 6, y: 5, rotation: 0, elevation: 0 },
      { catalogId: 'tree-apple', x: 7, y: 5, rotation: 0, elevation: 0 },
    ];
    decodeIcons(overlay, () => overlay.showGroupPlacementGhost(members, true));
    const sprites = ghosts(overlay);
    expect(sprites).toHaveLength(3);
    expect(sprites.every((s) => s.visible)).toBe(true);
    expect(new Set(sprites.map((s) => s.tint)).size).toBe(1); // one shared tint, not per-member
    // One scale on both axes, so the icon is not stretched into its footprint box.
    expect(sprites.every((s) => s.scale.x === s.scale.y)).toBe(true);
  });

  it('retints every sprite together on the next call (invalid → red)', () => {
    const overlay = new OverlayLayer(() => {});
    const members = [
      { catalogId: 'tree-apple', x: 5, y: 5, rotation: 0, elevation: 0 },
      { catalogId: 'tree-apple', x: 6, y: 5, rotation: 0, elevation: 0 },
    ];
    overlay.showGroupPlacementGhost(members, true);
    const validTint = ghosts(overlay)[0]!.tint;
    overlay.showGroupPlacementGhost(members, false);
    const invalidTint = ghosts(overlay)[0]!.tint;
    expect(invalidTint).not.toBe(validTint);
    expect(invalidTint, 'the loss red, lifted toward white for a multiplied icon').toBe(lerpColor(GHOST_LOSS, 0xffffff, 0.35));
    expect(ghosts(overlay).every((s) => s.tint === invalidTint)).toBe(true);
  });

  it('reuses the sprite pool: growing/shrinking the member count resizes it, not rebuilds it', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGroupPlacementGhost(
      [{ catalogId: 'tree-apple', x: 1, y: 1, rotation: 0, elevation: 0 }],
      true,
    );
    const first = ghosts(overlay)[0];
    overlay.showGroupPlacementGhost(
      [
        { catalogId: 'tree-apple', x: 1, y: 1, rotation: 0, elevation: 0 },
        { catalogId: 'tree-apple', x: 2, y: 1, rotation: 0, elevation: 0 },
      ],
      true,
    );
    expect(ghosts(overlay)).toHaveLength(2);
    expect(ghosts(overlay)[0]).toBe(first); // the original sprite is reused, not replaced

    overlay.showGroupPlacementGhost([], true);
    expect(ghosts(overlay)).toHaveLength(0);
  });

  it('an item with no sprite icon (a color-only road) hides its ghost sprite instead of drawing garbage', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGroupPlacementGhost([{ catalogId: 'no-such-item', x: 1, y: 1, rotation: 0, elevation: 0 }], true);
    expect(ghosts(overlay)[0]!.visible).toBe(false);
  });

  it('clearGhost() clears the group ghost pool alongside the single-item ghost', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGroupPlacementGhost(
      [{ catalogId: 'tree-apple', x: 1, y: 1, rotation: 0, elevation: 0 }],
      true,
    );
    expect(ghosts(overlay)).toHaveLength(1);
    overlay.clearGhost();
    expect(ghosts(overlay)).toHaveLength(0);
  });
});
