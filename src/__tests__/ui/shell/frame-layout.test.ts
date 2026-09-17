import { describe, expect, it } from 'vitest';
import { FIT_FLOOR_TOUCH, fittedUiScale, MIN_UI_ROOM } from '../../../ui/design/scale';
import { KIT_BUTTONS, MODE_ROW_INK_BOTTOM, MODES, planFrame, railClearanceFor, railStack, TOP_RIGHT, TOP_RIGHT_H, TOP_RIGHT_TOP, topRightHeight, blockCentre, viewKitCell } from '../../../ui/shell/frame';
import { EDGE_LEFT, EDGE_RIGHT, MODE_PLATE_W, MODE_SCALE, RAIL, TOP_RIGHT_GAP, ZOOM } from '../../../ui/shell/units';
import { PINNED_DOCK_REF_W, frameZoomAt } from '../../../ui/shell/panel-frame';
import { PLATE_MIN_WIDTH, plateDepth, plateMinDepth } from '../../../ui/shell/windows/LayerPanel';

const options = { open: false, plateDepth: plateDepth('grid'), plateMinDepth: plateMinDepth('grid'), plateMinWidth: PLATE_MIN_WIDTH };

describe('the shell shares the available workspace', () => {
  it('keeps the view kit within two files on a landscape phone at the touch floor', () => {
    for (const [vw, vh] of [[844, 390], [780, 360]] as const) {
      const chrome = fittedUiScale(vw, vh, 1, 0, FIT_FLOOR_TOUCH);
      const p = planFrame(vw / (chrome * ZOOM), vh / (chrome * ZOOM), options);
      expect(p.rail.kitFiles, `${vw}x${vh}`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps top actions beside the modes when they fit and below their captions when they do not', () => {
    const wide = planFrame(1200, 800, options);
    const narrow = planFrame(MIN_UI_ROOM.w / ZOOM, 500, options);
    expect(wide.cornerTop).toBe(TOP_RIGHT_TOP);
    expect(narrow.cornerTop).toBeGreaterThan(MODE_ROW_INK_BOTTOM);
    expect(narrow.railTop).toBeGreaterThanOrEqual(narrow.cornerTop + TOP_RIGHT_H + RAIL.gap);
  });

  it('keeps all controls on screen and leaves a usable scroll lane throughout the scale and aspect range', () => {
    const cornerWidth = TOP_RIGHT.reduce((sum, art) => sum + topRightHeight(art) * art.w / art.h, 0)
      + (TOP_RIGHT.length - 1) * TOP_RIGHT_GAP;
    const modeRight = blockCentre(MODES.length - 1) + MODE_PLATE_W * MODE_SCALE / 2;
    for (let vw = 320; vw <= 2400; vw += 97) for (let vh = 280; vh <= 1400; vh += 83) {
      for (const requested of [0.6, 1, 1.4, 1.8]) for (const dock of [0, PINNED_DOCK_REF_W]) {
        const chrome = fittedUiScale(vw, vh, requested, dock);
        const width = vw / (chrome * ZOOM) - dock / ZOOM;
        const height = vh / (chrome * ZOOM);
        for (const open of [false, true]) {
          const p = planFrame(width, height, { ...options, open });
          const rail = p.rail;
          expect(p.cornerTop === TOP_RIGHT_TOP
            ? width - p.edgeRight - cornerWidth >= modeRight + RAIL.groupMin
            : p.cornerTop > MODE_ROW_INK_BOTTOM).toBe(true);
          expect(rail.kitTop + railStack(Math.ceil(KIT_BUTTONS / rail.kitFiles))).toBeLessThan(height);
          expect(rail.kitTop).toBeGreaterThanOrEqual(p.railTop + RAIL.layer.h);
          expect(width - EDGE_LEFT - EDGE_RIGHT - railClearanceFor(p, 0, height)).toBeGreaterThan(120);
          expect(rail.plateMaxH).toBeGreaterThan(120);
          if (open) expect(p.plateMaxWidth).toBeGreaterThan(160);
        }
      }
    }
  });

  it('keeps history on the right below the layer control when the panel opens or the scale changes', () => {
    for (let height = 420; height <= 900; height += 10) {
      const closed = planFrame(746, height, options);
      const open = planFrame(746, height, { ...options, open: true });
      expect(open.edgeRight).toBe(closed.edgeRight);
      expect(open.rail.historyTop).toBeGreaterThanOrEqual(open.railTop + RAIL.layer.h);
      expect(open.rail.historyTop).toBeGreaterThanOrEqual(closed.rail.historyTop);
    }
  });

  it('folds history and the view kit and uses the bottom margin before moving the panel aside', () => {
    const open = planFrame(800, 600, { ...options, open: true });
    expect(open.rail.historyFiles).toBe(2);
    expect(open.rail.kitFiles).toBe(4);
    expect(open.rail.plateInLane).toBe(true);
    expect(open.rail.plateRight).toBe(open.edgeRight);
    expect(open.rail.plateMaxH).toBeGreaterThan(plateMinDepth('grid'));
  });

  it('reserves different widths for rows intersecting different rail cells', () => {
    const plan = planFrame(672, 420, options);
    expect(railClearanceFor(plan, 110, 56)).toBeLessThan(railClearanceFor(plan, 44, 43));
    expect(railClearanceFor(plan, 0, 4)).toBe(0);
    const roomier = planFrame(1024, 640, options);
    expect(railClearanceFor(roomier, 44, 43)).toBe(0);
  });

  it('uses the space beside lowered corner actions for the expanded panel', () => {
    const open = planFrame(672, 420, { ...options, open: true });
    expect(open.plateTop).toBe(open.cornerTop);
    expect(open.plateTop).toBeLessThan(open.railTop);
    expect(open.rail.plateMaxH).toBeGreaterThan(420 - open.railTop - 16);
  });

  it('uses the same fit during a dock slide as it does at either endpoint', () => {
    for (const fraction of [0, 0.01, 0.3, 0.8, 1]) {
      expect(frameZoomAt(fraction, 1280, 800, 1.8)).toBe(
        ZOOM * fittedUiScale(1280, 800, 1.8, fraction * PINNED_DOCK_REF_W),
      );
    }
  });

  it('keeps zoom and yaw pairs adjacent in the wider camera folds', () => {
    for (const files of [3, 4]) for (const count of [5, 7]) {
      for (const first of count === 7 ? [3, 5] : [3]) {
        const left = viewKitCell(first, count, files), right = viewKitCell(first + 1, count, files);
        expect(left.row).toBe(right.row);
        expect(left.column + 1).toBe(right.column);
      }
      const cells = Array.from({ length: count }, (_, i) => viewKitCell(i, count, files));
      expect(new Set(cells.map(c => `${c.column}:${c.row}`)).size).toBe(count);
      expect(Math.max(...cells.map(c => c.row))).toBeLessThanOrEqual(Math.ceil(KIT_BUTTONS / files));
    }
  });

  it('keeps the preferred size where it fits and bounds only the rendered size in cramped windows', () => {
    expect(fittedUiScale(2560, 1440, 1.8)).toBe(1.8);
    expect(fittedUiScale(1280, 800, 1)).toBe(1);
    const constrained = fittedUiScale(640, 360, 1.8);
    expect(640 / constrained).toBeGreaterThanOrEqual(MIN_UI_ROOM.w);
    expect(360 / constrained).toBeGreaterThanOrEqual(MIN_UI_ROOM.h);
  });
});
