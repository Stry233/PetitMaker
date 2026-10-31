/**
 * Property: at every depth the bottom dock can stand at, from its handle up to the most the frame lets
 * it reach (`bottomDockDepth` under the ceiling `planFrame`'s least height sets, never under
 * `bottomDockFloor`), the upright frame's plan leaves `bar.room`, before any clamp at zero, at least
 * the least depth of the panel open on the bar wherever the ceiling allows that depth, and the map
 * keeps at least three tenths of the window. The top margin narrows before the dock yields that far,
 * and a window too short even then yields the dock to its handle.
 */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { planFrame } from '../../../ui/shell/frame-plan';
import { BOTTOM_DOCK, bottomDockCeiling, bottomDockDepth, bottomDockFloor, frameZoomAt, frameZoomFor } from '../../../ui/shell/panel-frame';
import { HISTORY_BUTTONS, railStack } from '../../../ui/shell/frame';
import { EDGE, RAIL, SHELF_SCALE } from '../../../ui/shell/units';
import { uprightObjectLeast } from '../../../ui/shell/bars/objects/UprightObjectPanel';

const WINDOWS = [[360, 740], [390, 844], [820, 1180]] as const;
/** Least depths a panel may claim, in frame px: none, a short row and a tall one, and the object panel's. */
const PANELS = {
  none: 0,
  short: 80,
  tall: 200,
  objects: uprightObjectLeast((n) => Math.round(n * SHELF_SCALE)),
};
const OPTS = { open: false, plateDepth: 0, shape: 'portrait', inputMode: 'touch' } as const;
const STEP = 0.005;

/** The dock's ceiling for a panel needing `panelLeast`, as the frame hands it over. */
function ceilingFor(vw: number, vh: number, panelLeast: number): { ceiling: number; floor: number } {
  const free = frameZoomFor(vw, vh, 1, 0, { touch: true, upright: true });
  const { leastHeight } = planFrame(vw / free, vh / free, { ...OPTS, panelLeast });
  const floor = bottomDockFloor(free, vh);
  return { ceiling: Math.max(floor, bottomDockCeiling(leastHeight, free, vh)), floor };
}

describe('the bottom dock yields to the upright frame', () => {
  for (const [vw, vh] of WINDOWS) {
    for (const [panel, panelLeast] of Object.entries(PANELS)) {
      spec('UI-32', `at ${vw}x${vh} with ${panel} open, every reachable depth leaves the bar its panel's room`, () => {
        const { ceiling, floor } = ceilingFor(vw, vh, panelLeast);
        const most = bottomDockDepth(1, ceiling);
        const depths = [...Array.from({ length: Math.floor((most - floor) / STEP) + 1 }, (_, i) => floor + i * STEP), most];
        // Whatever the handle asks, the dock stands at one of these.
        for (const asked of [0, BOTTOM_DOCK.least, BOTTOM_DOCK.rest, BOTTOM_DOCK.most, 1]) {
          expect(bottomDockDepth(asked, ceiling)).toBeLessThanOrEqual(most);
          expect(bottomDockDepth(asked, ceiling)).toBeGreaterThanOrEqual(Math.min(floor, BOTTOM_DOCK.least));
        }
        for (const depth of depths) {
          const zoom = frameZoomAt(1, vw, vh, 1, { touch: true, upright: true, depth });
          const height = (vh - depth * vh) / zoom;
          const plan = planFrame(vw / zoom, height, { ...OPTS, panelLeast, panelDepth: panelLeast });
          // Down to the foot of undo and redo as the plan folds them.
          const room = height - plan.modeRow.band - (plan.rail.historyTop + railStack(Math.ceil(HISTORY_BUTTONS / plan.rail.historyFiles))) - RAIL.groupMin;
          if (depth <= ceiling) expect(room, `depth ${depth}`).toBeGreaterThanOrEqual(panelLeast - 1e-9);
          expect(depth, `depth ${depth}`).toBeLessThanOrEqual(1 - 3 / 10);
        }
      });
    }
  }

  spec('UI-32', 'the top margin narrows before the dock yields: where a tall panel bounds the dock, the top row already stands at the least margin', () => {
    let bound = 0;
    for (const [vw, vh] of WINDOWS) {
      const { ceiling, floor } = ceilingFor(vw, vh, PANELS.tall);
      if (ceiling <= floor || ceiling >= BOTTOM_DOCK.most) continue;
      bound++;
      // The frame bounds the dock at the zoom it has with no dock (`frame-layout.tsx`), the largest it
      // draws at, so the plan that bounds it is the one at that zoom.
      const zoom = frameZoomFor(vw, vh, 1, 0, { touch: true, upright: true });
      const at = (panelLeast: number) => planFrame(vw / zoom, (vh - ceiling * vh) / zoom, { ...OPTS, panelLeast, panelDepth: panelLeast });
      expect(at(PANELS.tall).cornerTop, `${vw}x${vh}`).toBeCloseTo(EDGE, 6);
      expect(at(0).cornerTop, `${vw}x${vh}`).toBeGreaterThan(EDGE);
    }
    expect(bound).toBeGreaterThan(0);
  });

  spec('UI-32', 'a window too short for an open panel yields the dock down to its handle, which stays in sight', () => {
    const { ceiling, floor } = ceilingFor(375, 667, 480);
    expect(ceiling).toBe(floor);
    expect(floor).toBeGreaterThan(0);
    for (const asked of [0, BOTTOM_DOCK.least, BOTTOM_DOCK.rest, 1]) expect(bottomDockDepth(asked, ceiling)).toBe(floor);
  });
});
