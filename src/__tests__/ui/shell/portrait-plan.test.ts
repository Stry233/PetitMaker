/**
 * The upright frame plan: the mode row in a bar at the window's foot, the character top left, the
 * corner actions top right and the right-hand column under them, for phones and tablets held upright.
 */
import { describe, expect, it } from 'vitest';
import { spec } from '../../_support/spec';
import { HISTORY_BUTTONS, KIT_BUTTONS, MODES, TOP_RIGHT, TOP_RIGHT_H, TURN_BUTTONS, ZOOM_BUTTONS, blockCentre, cornerWidth, railStack } from '../../../ui/shell/frame';
import { planFrame, railClearanceFor, type FrameLayout } from '../../../ui/shell/frame-plan';
import { CHARACTER_SEAT, TOUCH_FRAME_REACH, frameZoomFor } from '../../../ui/shell/panel-frame';
import { EDGE, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, LABEL_BOX_DEPTH, MODE, MODE_PLATE_W, MODE_SCALE, RAIL, UPRIGHT_TOUCH_EDGE } from '../../../ui/shell/units';
import { PLATE_MIN_WIDTH, plateDepth, plateMinDepth } from '../../../ui/shell/controls/layer-plate';
import { TOUCH_TARGET } from '../../../ui/design/scale';

const options = { open: false, plateDepth: plateDepth('pill'), plateMinDepth: plateMinDepth('pill'), plateMinWidth: PLATE_MIN_WIDTH };

/** Phones and tablets held upright, in the frame px touch mode draws them at. */
const UPRIGHT = [[390, 844], [360, 740], [820, 1180], [768, 1024]] as const;

function upright(vw: number, vh: number, inputMode: 'touch' | 'pc' = 'touch', extra: Partial<Parameters<typeof planFrame>[2]> = {}): FrameLayout {
  const zoom = frameZoomFor(vw, vh, 1, 0, { touch: inputMode === 'touch', upright: true });
  return planFrame(vw / zoom, vh / zoom, { ...options, shape: 'portrait', inputMode, ...extra });
}

/** How far the kit's buttons reach down, in frame px. */
const kitBottom = (p: FrameLayout) => p.rail.kitTop + railStack(Math.ceil(p.rail.kitButtons / p.rail.kitFiles));

describe('the upright frame plan', () => {
  spec('UI-28', 'at 390x844 the mode tiles sit in a bottom bar and the corner actions top right', () => {
    const p = upright(390, 844);
    expect(p.shape).toBe('portrait');
    expect(p.modeRow.placement).toBe('bottom');
    // The row stands inside its bar, the bar at the window's foot, the selected name inside it too.
    expect(p.modeRow.band).toBeGreaterThan(MODE.height);
    expect(p.modeRow.top).toBeGreaterThanOrEqual(p.height - p.modeRow.band);
    expect(p.modeRow.top + MODE.height + MODE.label.gap + LABEL_BOX_DEPTH * MODE.label.size).toBeLessThanOrEqual(p.height);
    // The corner cluster ends at the right margin, at the top, and the character stands top left.
    expect(p.cornerLeft + cornerWidth(TOP_RIGHT)).toBeCloseTo(p.width - p.edgeRight, 6);
    expect(p.cornerTop).toBeLessThan(p.height / 8);
    expect(p.character.left + CHARACTER_SEAT.w).toBeLessThan(p.cornerLeft);
    expect(p.character.top + CHARACTER_SEAT.h).toBeLessThan(p.railTop);
  });

  spec('UI-28', 'every upright window keeps all five tiles and their splat inside its width', () => {
    for (const [vw, vh] of UPRIGHT) {
      const p = upright(vw, vh);
      const row = p.modeRow;
      const plate = (MODE_PLATE_W * MODE_SCALE) / 2;
      expect(blockCentre(0, row) - plate, `${vw}x${vh}`).toBeGreaterThanOrEqual(-1e-9);
      expect(blockCentre(MODES.length - 1, row) + plate, `${vw}x${vh}`).toBeLessThanOrEqual(p.width + 1e-9);
      expect(row.gap, `${vw}x${vh}`).toBeGreaterThan(0);
    }
  });

  spec('UI-28', 'the right column runs layer control, undo and redo, then the view kit, top down above the bar', () => {
    for (const [vw, vh] of UPRIGHT) {
      const p = upright(vw, vh);
      const at = `${vw}x${vh}`;
      expect(p.railTop, at).toBeGreaterThanOrEqual(p.cornerTop + TOP_RIGHT_H);
      expect(p.rail.historyFiles, at).toBe(1);
      expect(p.rail.kitFiles, at).toBe(1);
      expect(p.rail.historyTop, at).toBeGreaterThan(p.railTop + RAIL.layer.h);
      expect(p.rail.kitTop, at).toBeGreaterThan(p.rail.historyTop + railStack(HISTORY_BUTTONS));
      expect(kitBottom(p), at).toBeLessThan(p.height - p.modeRow.band);
    }
  });

  it('drops the zoom pair and the turns in touch mode in either shape, where a pinch and a twist replace them, and keeps them for a mouse', () => {
    const touch = upright(390, 844, 'touch');
    expect(touch.rail.steppers).toBe(false);
    expect(touch.rail.kitButtons).toBe(KIT_BUTTONS - ZOOM_BUTTONS - TURN_BUTTONS);
    const pc = upright(390, 844, 'pc');
    expect(pc.rail.steppers).toBe(true);
    expect(pc.rail.kitButtons).toBe(KIT_BUTTONS);
    expect(planFrame(1024, 640, options).rail.steppers).toBe(true);
    const landscape = planFrame(1024, 640, { ...options, shape: 'landscape', inputMode: 'touch' });
    expect(landscape.rail.steppers).toBe(false);
    expect(landscape.rail.kitButtons).toBe(KIT_BUTTONS - ZOOM_BUTTONS - TURN_BUTTONS);
  });

  it('keeps history, the kit and the layer control\'s bottom step hit area apart in touch mode', () => {
    // Boxes in frame px, x measured leftward from the column's right edge. The step is half the plate
    // tall; its hit area grows down to a fingertip, as far as TOUCH_FRAME_REACH at the touch frame's least zoom.
    type Box = { right: number; left: number; top: number; bottom: number };
    const meets = (a: Box, b: Box) => a.right < b.left && b.right < a.left && a.top < b.bottom && b.top < a.bottom;
    for (const [vw, vh] of [...UPRIGHT, [844, 390], [1180, 820], [740, 360], [667, 375], [568, 320]] as const) {
      const zoom = frameZoomFor(vw, vh, 1, 0, { touch: true, upright: true });
      const shape = vh > vw ? 'portrait' : 'landscape';
      const p = planFrame(vw / zoom, vh / zoom, { ...options, shape, inputMode: 'touch' });
      const at = `${vw}x${vh}`;
      const reach: Box = { right: 0, left: TOUCH_TARGET, top: p.railTop, bottom: p.railTop + RAIL.layer.h + (TOUCH_FRAME_REACH - RAIL.layer.h / 2) };
      const history: Box = {
        right: p.rail.historyInset, left: p.rail.historyInset + railStack(p.rail.historyFiles),
        top: p.rail.historyTop, bottom: p.rail.historyTop + railStack(Math.ceil(HISTORY_BUTTONS / p.rail.historyFiles)),
      };
      const kit: Box = { right: 0, left: railStack(p.rail.kitFiles), top: p.rail.kitTop, bottom: kitBottom(p) };
      expect(meets(history, reach), `${at} layer step`).toBe(false);
      expect(meets(history, kit), `${at} kit`).toBe(false);
      const layer: Box = { right: 0, left: TOUCH_TARGET, top: p.railTop, bottom: p.railTop + RAIL.layer.h };
      expect(meets(kit, layer), `${at} kit and layer control`).toBe(false);
      // At 568x320 the kit's one row stands 7 px into the bottom step's hit area: the corner drops
      // under the mode row there and leaves no more room under the layer control.
      if (!(vw === 568 && vh === 320)) expect(meets(kit, reach), `${at} kit and layer step`).toBe(false);
      expect(history.bottom, at).toBeLessThanOrEqual(p.height);
    }
  });

  it('opens the layer plate beside the column, inside the window', () => {
    const p = upright(390, 844, 'touch', { open: true, plateDepth: plateDepth('column'), plateMinDepth: plateMinDepth('column') });
    expect(p.rail.plateInLane).toBe(false);
    expect(p.rail.plateRight).toBeGreaterThan(p.edgeRight + railStack(p.rail.kitFiles));
    expect(p.plateMaxWidth).toBeGreaterThan(0);
    expect(p.plateTop + p.rail.plateMaxH).toBeLessThanOrEqual(p.height - p.modeRow.band);
  });

  it('stands the shelves on top of the bar', () => {
    const p = upright(390, 844);
    expect(p.bar.bottom).toBe(p.modeRow.band);
  });

  spec('UI-28', 'a panel open on the bar grows no higher than undo and redo and steps the kit rows under it aside', () => {
    for (const [vw, vh] of UPRIGHT) {
      const at = `${vw}x${vh}`;
      const rest = upright(vw, vh);
      expect(rest.rail.kitRows, at).toBeUndefined();
      // The room runs from the bar's top to just under history, the least of the column the map keeps.
      const room = rest.bar.room!;
      expect(rest.height - rest.modeRow.band - room - RAIL.groupMin, at).toBeCloseTo(rest.rail.historyTop + railStack(HISTORY_BUTTONS), 6);
      const open = upright(vw, vh, 'touch', { panelDepth: room });
      expect(open.rail.kitRows, at).toBe(0);
      // The column above the panel keeps its places.
      expect(open.rail.kitTop, at).toBe(rest.rail.kitTop);
      expect(open.rail.historyTop, at).toBe(rest.rail.historyTop);
      // A shallow panel leaves every row standing.
      expect(upright(vw, vh, 'touch', { panelDepth: 1 }).rail.kitRows, at).toBeUndefined();
    }
  });

  spec('UI-28', 'an open layer plate stops short of a panel open on the bar', () => {
    for (const [vw, vh] of UPRIGHT) {
      const room = upright(vw, vh).bar.room!;
      for (const panelDepth of [0, room / 2, room]) {
        const p = upright(vw, vh, 'touch', { open: true, plateDepth: plateDepth('column'), plateMinDepth: plateMinDepth('column'), panelDepth });
        expect(p.plateTop + p.rail.plateMaxH, `${vw}x${vh} ${panelDepth}`).toBeLessThanOrEqual(p.height - p.modeRow.band - panelDepth + 1e-9);
        expect(p.rail.plateMaxH, `${vw}x${vh} ${panelDepth}`).toBeGreaterThan(0);
      }
    }
  });

  spec('UI-28', 'a handle may draw an upright panel up to the top row, over the column, which keeps its plan', () => {
    for (const [vw, vh] of UPRIGHT) {
      const at = `${vw}x${vh}`;
      const rest = upright(vw, vh);
      const reach = rest.bar.reach!;
      expect(reach, at).toBeGreaterThan(rest.bar.room!);
      // It stops under the top row.
      expect(rest.height - rest.modeRow.band - reach, at).toBeGreaterThanOrEqual(rest.cornerTop + TOP_RIGHT_H);
      // A panel that tall covers the column: the column is planned as for a panel filling the room.
      const tall = upright(vw, vh, 'touch', { panelDepth: reach });
      const full = upright(vw, vh, 'touch', { panelDepth: rest.bar.room! });
      expect(tall.rail, at).toEqual(full.rail);
      expect(tall.rail.plateMaxH, at).toBeGreaterThan(0);
    }
  });

  spec('UI-28', 'every row of an upright panel reaches the right margin, since the panel never stands beside the column', () => {
    // Short heights are what a docked assistant leaves the frame.
    for (const [vw, vh] of [...UPRIGHT, [390, 500], [375, 450], [360, 420]] as const) {
      for (const inputMode of ['touch', 'pc'] as const) {
        const rest = upright(vw, vh, inputMode);
        for (const panelDepth of [0, rest.bar.room! / 2, rest.bar.room!, rest.bar.reach!]) {
          const p = upright(vw, vh, inputMode, { panelDepth });
          for (let bottom = 0; bottom < p.bar.reach!; bottom += 8) {
            expect(railClearanceFor(p, bottom, 40), `${vw}x${vh} ${inputMode} ${panelDepth} ${bottom}`).toBe(0);
          }
        }
      }
    }
  });

  spec('UI-28', 'the upright frame keeps its own margins in touch mode and the wide ones for a mouse, narrowing them only where the top row or an open panel needs the room', () => {
    const bases = { touch: [UPRIGHT_TOUCH_EDGE.side, UPRIGHT_TOUCH_EDGE.side, UPRIGHT_TOUCH_EDGE.top], pc: [EDGE_LEFT, EDGE_RIGHT, EDGE_TOP] } as const;
    for (const inputMode of ['touch', 'pc'] as const) {
      const [left, right, top] = bases[inputMode];
      for (const [vw, vh] of UPRIGHT) {
        const at = `${inputMode} ${vw}x${vh}`;
        const rest = upright(vw, vh, inputMode);
        // The top is the base with no panel open, and the sides the base pair, alike narrowed.
        expect(rest.cornerTop, at).toBe(top);
        expect(rest.edgeLeft, at).toBeLessThanOrEqual(left);
        expect(rest.edgeRight, at).toBeLessThanOrEqual(right);
        expect(Math.min(rest.edgeLeft, rest.edgeRight), at).toBeGreaterThanOrEqual(EDGE);
        expect((rest.edgeLeft - EDGE) * (right - EDGE), at).toBeCloseTo((rest.edgeRight - EDGE) * (left - EDGE), 6);
        if (vw >= 768) expect([rest.edgeLeft, rest.edgeRight], at).toEqual([left, right]);
        // A panel a little taller than the room takes it from the top margin, which stops at EDGE.
        const room = rest.bar.room!;
        for (const over of [2, top - EDGE, 40]) {
          const p = upright(vw, vh, inputMode, { panelLeast: room + over, panelDepth: room + over });
          expect(p.cornerTop, `${at} +${over}`).toBe(Math.max(EDGE, top - over));
          if (over <= top - EDGE) expect(p.bar.room, `${at} +${over}`).toBeGreaterThanOrEqual(room + over - 1e-6);
        }
      }
    }
  });
});

