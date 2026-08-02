/**
 * OverlayLayer.showGroupPlacementGhost — the real 2D implementation behind the group drag ghost
 * (see group-drag-ghost.test.tsx for the pointer-machine wiring, which exercises this through a
 * mocked ToolOverlay instead). Pinned here: a sprite per member, ALL sharing one validity tint, and
 * the sprite POOL is reused across calls (a shrink/grow trims or grows it) rather than
 * destroyed/recreated wholesale — the cost a 40-member drag would otherwise pay every pointer move.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';

type Sprite = {
  visible: boolean; tint: number; scale: { x: number; y: number };
  texture: { baseTexture: { setRealSize: (w: number, h: number) => void } };
};

function ghosts(overlay: OverlayLayer): Sprite[] {
  return (overlay as unknown as { groupGhosts: Sprite[] }).groupGhosts;
}

/**
 * Mark every ghost's icon decoded and repaint.
 *
 * The sprite fit waits on texture decode before sizing or revealing anything, which is what keeps
 * a 0x0 sprite off the screen. jsdom never decodes an image, so without this the assertions below
 * would all read the pre-decode state; a browser reaches a ghost with these icons long since
 * decoded by the object layer.
 *
 * The size is deliberately NOT square. Catalog icons are not, and a stretch to the footprint box
 * is invisible when texture and footprint share an aspect — a square icon in a 1x1 footprint
 * scales the same on both axes however it is fitted, so it could not tell the two apart.
 */
function decodeIcons(overlay: OverlayLayer, repaint: () => void): void {
  for (const s of ghosts(overlay)) s.texture.baseTexture.setRealSize(64, 32);
  repaint();
}

describe('OverlayLayer group placement ghost', () => {
  it('draws one sprite per member, all sharing the SAME validity tint', () => {
    const overlay = new OverlayLayer();
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
    // ONE scale on both axes: the ghost has to show the shape the drop will produce, and sizing
    // width and height separately would stretch the icon into its footprint box.
    expect(sprites.every((s) => s.scale.x === s.scale.y)).toBe(true);
  });

  it('retints every sprite together on the next call (invalid → red)', () => {
    const overlay = new OverlayLayer();
    const members = [
      { catalogId: 'tree-apple', x: 5, y: 5, rotation: 0, elevation: 0 },
      { catalogId: 'tree-apple', x: 6, y: 5, rotation: 0, elevation: 0 },
    ];
    overlay.showGroupPlacementGhost(members, true);
    const validTint = ghosts(overlay)[0]!.tint;
    overlay.showGroupPlacementGhost(members, false);
    const invalidTint = ghosts(overlay)[0]!.tint;
    expect(invalidTint).not.toBe(validTint);
    expect(ghosts(overlay).every((s) => s.tint === invalidTint)).toBe(true);
  });

  it('reuses the sprite pool: growing/shrinking the member count resizes it, not rebuilds it', () => {
    const overlay = new OverlayLayer();
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
    expect(ghosts(overlay)[0]).toBe(first); // the original sprite is REUSED, not replaced

    overlay.showGroupPlacementGhost([], true);
    expect(ghosts(overlay)).toHaveLength(0);
  });

  it('an item with no sprite icon (a color-only road) hides its ghost sprite instead of drawing garbage', () => {
    const overlay = new OverlayLayer();
    overlay.showGroupPlacementGhost([{ catalogId: 'no-such-item', x: 1, y: 1, rotation: 0, elevation: 0 }], true);
    expect(ghosts(overlay)[0]!.visible).toBe(false);
  });

  it('clearGhost() clears the group ghost pool alongside the single-item ghost', () => {
    const overlay = new OverlayLayer();
    overlay.showGroupPlacementGhost(
      [{ catalogId: 'tree-apple', x: 1, y: 1, rotation: 0, elevation: 0 }],
      true,
    );
    expect(ghosts(overlay)).toHaveLength(1);
    overlay.clearGhost();
    expect(ghosts(overlay)).toHaveLength(0);
  });
});
