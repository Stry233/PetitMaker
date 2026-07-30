// chunk-grid.ts — spatial bucket containers with viewport culling.
//
// The renderer's display list has NO built-in culling: every rendered frame traverses and
// batch-processes every node, on-screen or not, so pan/zoom/animation cost scales with the MAP
// TOTAL (thousands of terrain Graphics + object sprites on a generated map) instead of what's
// visible. A ChunkGrid groups a layer's children into per-chunk containers (CHUNK_SIZE-cell
// squares, matching the game's chunk grid) and toggles each chunk's `visible` against the camera
// rect — Pixi skips an invisible container's whole subtree in both updateTransform and render, so
// frame cost tracks the objects ON SCREEN.
//
// The cull test + camera rect are pure functions in chunk-cull.ts (unit-tested headlessly);
// only this container plumbing touches Pixi.
import * as PIXI from 'pixi.js-legacy';
import { CHUNK_PX, chunkVisible, type CullRect } from './chunk-cull';

export { cullRect, type CullRect } from './chunk-cull';

export class ChunkGrid {
  private chunks = new Map<string, { c: PIXI.Container; cx: number; cy: number }>();
  private lastRect: CullRect | null = null;

  constructor(private root: PIXI.Container) {}

  /** The bucket container for a child anchored at (worldX, worldY), created on first use —
   *  already culled against the last camera rect, so late additions don't flash on-screen. */
  bucketFor(worldX: number, worldY: number): PIXI.Container {
    const cx = Math.floor(worldX / CHUNK_PX), cy = Math.floor(worldY / CHUNK_PX);
    const key = `${cx},${cy}`;
    let e = this.chunks.get(key);
    if (!e) {
      e = { c: new PIXI.Container(), cx, cy };
      if (this.lastRect) e.c.visible = chunkVisible(cx, cy, this.lastRect);
      this.chunks.set(key, e);
      this.root.addChild(e.c);
    }
    return e.c;
  }

  /** Toggle every chunk's visibility against the camera rect. O(chunks), not O(children). */
  cull(rect: CullRect): void {
    this.lastRect = rect;
    for (const e of this.chunks.values()) e.c.visible = chunkVisible(e.cx, e.cy, rect);
  }

  /** The bucket containers currently visible under the last camera rect — for work
   *  that builds lazily per on-screen chunk (e.g. the object elevation labels). */
  visibleBuckets(): PIXI.Container[] {
    const out: PIXI.Container[] = [];
    for (const e of this.chunks.values()) if (e.c.visible) out.push(e.c);
    return out;
  }

  /** Destroy all buckets AND their children (a full-layer rebuild). Keeps the last camera rect so
   *  the rebuilt buckets cull correctly from birth. */
  clear(): void {
    for (const e of this.chunks.values()) e.c.destroy({ children: true });
    this.chunks.clear();
  }
}
