/**
 * The selection ring must ride the SAME per-tick progress a rotation's sprites/instances get,
 * instead of computing its own interpolation of the same turn (see `canvas/group-arc.ts`'s file
 * header for why a second interpolation of one motion is exactly the bug class this guards against).
 * Two halves: the pure "given this eased progress, what does the ring look like" logic
 * (`paintSpinRing`/`paintGroupRotationArc`), and the onFrame plumbing through the PIXI tweens
 * themselves (`animateRotation`/`animateGroupRotation`), asserted against the exact eased value
 * applied to the icon/instance that same tick.
 */
import './_pixi-env'; // object-animations reaches PIXI, which needs jsdom's missing 2D context
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { paintSpinRing, paintGroupRotationArc } from '../../canvas/interaction/usePointerInteraction';
import { animateRotation, animateGroupRotation } from '../../canvas/map2d/layers/object-animations';
import { arcMotion, arcOffset, type GroupRotation } from '../../canvas/group-arc';
import { animConfig, easeOutBack } from '../../core/runtime/anim-config';
import { setReducedMotion, __resetMotionState } from '../../canvas/map2d/motion-state';
import type { ToolOverlay } from '../../canvas/view-projection';
import { ItemCategory } from '../../core/model/types';
import type { GridState, PlacedObject } from '../../core/model/types';
import { registerCatalogItem } from '../../state/catalog';
import { makeState } from '../rules/_helpers';

registerCatalogItem({
  id: 'ring-hut', category: ItemCategory.Building, name: { en: 'Ring Hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point',
  traits: [],
});
registerCatalogItem({
  id: 'ring-wide', category: ItemCategory.Building, name: { en: 'Ring Wide' },
  width: 3, height: 1, loadValue: 0, rotatable: true, placementMode: 'point',
  traits: [],
});
registerCatalogItem({
  id: 'ring-fixed', category: ItemCategory.Flora, name: { en: 'Ring Fixed' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

function place(gs: GridState, id: string, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): void {
  const obj: PlacedObject = { id, catalogId, position: { x, y }, rotation, elevation: 0 };
  gs.objects.set(id, obj);
}

/** A recording ToolOverlay stub — only the calls this feature touches. */
function fakeOverlay(): ToolOverlay & {
  selections: Array<{ x: number; y: number; w: number; h: number; elevation?: number; terrainMode?: boolean; append?: boolean }>;
  clears: number;
} {
  const selections: Array<{ x: number; y: number; w: number; h: number; elevation?: number; terrainMode?: boolean; append?: boolean }> = [];
  return {
    selections,
    clears: 0,
    showGhost: () => {}, showGhostSpans: () => {}, clearGhost: () => {},
    showSelection: (x, y, w = 1, h = 1, elevation, terrainMode = false, append = false) => {
      selections.push({ x, y, w, h, elevation, terrainMode, append });
    },
    clearSelection() { this.clears++; },
    showHover: () => {}, clearHover: () => {},
    flashCommit: () => {},
    showBuildableRegion: () => {}, clearBuildableRegion: () => {},
    showBand: () => {}, clearBand: () => {},
  };
}

afterEach(() => __resetMotionState());

describe('paintSpinRing (single-object onFrame)', () => {
  it('mid-tween: the same fixed footprint, position never offset (a lone spin never moves)', () => {
    const gs = makeState(20, 20);
    place(gs, 'a', 'ring-wide', 4, 4, 90); // already committed to the POST-turn rotation/size
    const overlay = fakeOverlay();
    paintSpinRing(overlay, gs, 'a', 0.3, false);
    expect(overlay.clears).toBe(1);
    // getRotatedSize(3x1, rotation=90) = {w:1, h:3} — the ALREADY-final shape, held throughout.
    // A single (non-append) ring keeps its elevation label mid-tween too, matching the static case.
    expect(overlay.selections).toEqual([{ x: 4, y: 4, w: 1, h: 3, elevation: 0, terrainMode: false, append: false }]);
  });

  it('settling frame (eased=1) repaints through the normal single-selection path, elevation included', () => {
    const gs = makeState(20, 20);
    place(gs, 'a', 'ring-hut', 4, 4);
    const overlay = fakeOverlay();
    paintSpinRing(overlay, gs, 'a', 1, false);
    expect(overlay.selections).toEqual([{ x: 4, y: 4, w: 1, h: 1, elevation: 0, terrainMode: false, append: false }]);
  });

  it('a vanished object mid-flight draws nothing rather than throwing', () => {
    const gs = makeState(20, 20);
    const overlay = fakeOverlay();
    expect(() => paintSpinRing(overlay, gs, 'ghost', 0.5, false)).not.toThrow();
    expect(overlay.selections).toEqual([]);
  });
});

describe('paintGroupRotationArc (group onFrame)', () => {
  const turnOf = (members: GroupRotation['members']): GroupRotation => ({ pivot: { x: 5.5, y: 4.5 }, sweepDeg: 90, members });

  it('mid-tween: each ring travels the SAME arc offset its wrapper would (arcOffset, shared math)', () => {
    const gs = makeState(20, 20);
    place(gs, 'a', 'ring-hut', 5, 3); // final (post-turn) position
    place(gs, 'c', 'ring-hut', 5, 5);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const overlay = fakeOverlay();
    paintGroupRotationArc(overlay, gs, turn, 0.4, false);
    expect(overlay.clears).toBe(1);
    const sweepRad = Math.PI / 2;
    for (const [i, m] of turn.members.entries()) {
      const { dx, dy } = arcOffset(arcMotion(turn.pivot, m.from), sweepRad, 0.4);
      const obj = gs.objects.get(m.id)!;
      expect(overlay.selections[i]!.x).toBeCloseTo(obj.position.x + dx, 10);
      expect(overlay.selections[i]!.y).toBeCloseTo(obj.position.y + dy, 10);
      expect(overlay.selections[i]!.append).toBe(true);
      expect(overlay.selections[i]!.elevation).toBeUndefined(); // a group ring never shows one label for N members
    }
  });

  it('a non-square SPUN member holds its FINAL (already-swapped) shape for the whole tween: no morph, no rotated draw', () => {
    const gs = makeState(20, 20);
    place(gs, 'wide', 'ring-wide', 5, 3, 90); // already 1x3 — the command committed before any tween frame
    const turn = turnOf([{ id: 'wide', from: { x: 5.5, y: 4.5 }, spun: true }]);
    const overlay = fakeOverlay();
    for (const eased of [0, 0.25, 0.6, 0.99]) {
      overlay.selections.length = 0;
      paintGroupRotationArc(overlay, gs, turn, eased, false);
      expect(overlay.selections[0]!.w).toBe(1);
      expect(overlay.selections[0]!.h).toBe(3);
    }
  });

  it('a CARRIED (non-spun) member still travels the arc: only its facing is exempt, not its position', () => {
    const gs = makeState(20, 20);
    place(gs, 'flower', 'ring-fixed', 5, 5);
    const turn = turnOf([{ id: 'flower', from: { x: 6.5, y: 4.5 }, spun: false }]);
    const overlay = fakeOverlay();
    paintGroupRotationArc(overlay, gs, turn, 0.5, false);
    const obj = gs.objects.get('flower')!;
    expect(overlay.selections[0]!.x).not.toBeCloseTo(obj.position.x, 6); // it DID move mid-tween
  });

  it('at eased=1, every ring lands exactly on the plain (already-committed) selection', () => {
    const gs = makeState(20, 20);
    place(gs, 'a', 'ring-hut', 5, 3);
    place(gs, 'c', 'ring-hut', 5, 5);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const overlay = fakeOverlay();
    paintGroupRotationArc(overlay, gs, turn, 1, false);
    expect(overlay.selections).toEqual([
      { x: 5, y: 3, w: 1, h: 1, elevation: undefined, terrainMode: false, append: true },
      { x: 5, y: 5, w: 1, h: 1, elevation: undefined, terrainMode: false, append: true },
    ]);
  });

  it('a member that vanished mid-flight is skipped, not thrown on', () => {
    const gs = makeState(20, 20);
    place(gs, 'a', 'ring-hut', 5, 3);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'gone', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const overlay = fakeOverlay();
    expect(() => paintGroupRotationArc(overlay, gs, turn, 0.5, false)).not.toThrow();
    expect(overlay.selections.length).toBe(1);
  });
});

/** A stand-in object wrapper: '_icon' is the child animateRotation/the arc spin tween drives. */
function wrapper(x: number, y: number, withIcon: boolean): PIXI.Container {
  const c = new PIXI.Container();
  c.x = x; c.y = y;
  if (withIcon) {
    const icon = new PIXI.Container();
    icon.name = '_icon';
    c.addChild(icon);
  }
  return c;
}

function withFakeRaf(): { step: (ts: number) => void; restore: () => void } {
  let queue: FrameRequestCallback[] = [];
  const spy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { queue.push(cb); return queue.length; });
  return {
    step: (ts: number) => { const due = queue; queue = []; for (const cb of due) cb(ts); },
    restore: () => spy.mockRestore(),
  };
}

describe('animateRotation onFrame (the seam animateRotation offers the ring)', () => {
  it('fires each tick with the SAME eased value driving the icon, exactly 1 on the settling frame', () => {
    const w = wrapper(0, 0, true);
    const map = new Map([['a', w]]);
    const frames: number[] = [];
    const raf = withFakeRaf();
    animateRotation(map, 'a', 0, 90, (eased) => frames.push(eased));
    const { durationMs, overshoot } = animConfig.rotation;
    raf.step(0);
    raf.step(0.5 * durationMs);
    raf.step(durationMs);
    const icon = w.children[0]!;
    expect(frames).toEqual([
      easeOutBack(0, overshoot), easeOutBack(0.5, overshoot), 1,
    ]);
    expect(icon.rotation).toBeCloseTo(Math.PI / 2, 10); // lands exactly where the icon does
    raf.restore();
  });

  it('never fires under reduced motion: the ring was already painted at the end state', () => {
    setReducedMotion(true);
    const w = wrapper(0, 0, true);
    const onFrame = vi.fn();
    animateRotation(new Map([['a', w]]), 'a', 0, 90, onFrame);
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe('animateGroupRotation onFrame (the seam animateGroupRotation offers the ring)', () => {
  it('fires ONCE per tick (not once per member) with the same eased value driving every wrapper', () => {
    const map = new Map<string, PIXI.Container>([['a', wrapper(5, 3, true)], ['b', wrapper(5, 4, true)]]);
    const turn: GroupRotation = {
      pivot: { x: 5.5, y: 4.5 }, sweepDeg: 90,
      members: [{ id: 'a', from: { x: 4.5, y: 4.5 }, spun: true }, { id: 'b', from: { x: 5.5, y: 4.5 }, spun: true }],
    };
    const frames: number[] = [];
    const raf = withFakeRaf();
    animateGroupRotation(map, turn, (eased) => frames.push(eased));
    const { durationMs, overshoot } = animConfig.groupRotation;
    raf.step(0);
    raf.step(0.3 * durationMs);
    raf.step(durationMs);
    expect(frames).toEqual([easeOutBack(0, overshoot), easeOutBack(0.3, overshoot), 1]);
    raf.restore();
  });

  it('never fires under reduced motion', () => {
    setReducedMotion(true);
    const map = new Map<string, PIXI.Container>([['a', wrapper(5, 3, true)]]);
    const onFrame = vi.fn();
    animateGroupRotation(map, { pivot: { x: 5, y: 3 }, sweepDeg: 90, members: [{ id: 'a', from: { x: 5, y: 3 }, spun: true }] }, onFrame);
    expect(onFrame).not.toHaveBeenCalled();
  });
});
