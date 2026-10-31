import { describe, expect, it } from 'vitest';
import { MODE_ROW_LEFT, MODE_ROW_TOP, TOP_RIGHT, TOP_RIGHT_TOP, cornerWidth } from '../../../ui/shell/frame';
import { planFrame } from '../../../ui/shell/frame-plan';
import { CHARACTER_SEAT, PANEL_LEFT, PANEL_TOP } from '../../../ui/shell/panel-frame';
import { EDGE_RIGHT, MODE, PLATE_BAND, SHELF_TABS, ZOOM } from '../../../ui/shell/units';
import { PLATE_MIN_WIDTH, plateDepth, plateMinDepth } from '../../../ui/shell/controls/layer-plate';

const options = { open: false, plateDepth: plateDepth('pill'), plateMinDepth: plateMinDepth('pill'), plateMinWidth: PLATE_MIN_WIDTH };
const WINDOWS = [[1280, 800], [1024, 768], [1440, 900], [700, 560]] as const;

describe('the landscape PC frame plan places every surface at its fixed anchor', () => {
  it('puts the mode row, seat, bottom band and corner where the frame art anchors them', () => {
    for (const [vw, vh] of WINDOWS) {
      const p = planFrame(vw / ZOOM, vh / ZOOM, options);
      const at = `${vw}x${vh}`;
      expect(p.shape, at).toBe('landscape');
      expect(p.modeRow, at).toMatchObject({ left: MODE_ROW_LEFT, top: MODE_ROW_TOP, gap: MODE.gap, placement: 'top', band: 0 });
      expect(p.character, at).toEqual({ left: CHARACTER_SEAT.left, top: CHARACTER_SEAT.top });
      expect(p.cornerTop, at).toBe(TOP_RIGHT_TOP);
      expect(p.panel, at).toEqual({ left: PANEL_LEFT, top: PANEL_TOP });
      expect(p.bar, at).toEqual({ bottom: 0, height: PLATE_BAND.top, tabsTop: SHELF_TABS.floor });
      // The narrowest window draws the right gutter in to keep room for the layer plate.
      if (vw >= 1024) expect(p.edgeRight, at).toBe(EDGE_RIGHT);
      expect(p.cornerLeft, at).toBe(p.width - p.edgeRight - cornerWidth(TOP_RIGHT));
    }
  });

  it('folds the modes into one stack where the top row cannot hold them beside the corner actions, and moves nothing else', () => {
    const narrow = planFrame(560, 600, options);
    expect(narrow.modeRow.folded).toBe(true);
    expect(narrow.cornerTop, 'the corner keeps its row').toBe(TOP_RIGHT_TOP);
    expect(narrow.character, 'her seat stays under the first block').toEqual({ left: CHARACTER_SEAT.left, top: CHARACTER_SEAT.top });
    const open = planFrame(560, 600, { ...options, rowOpen: true });
    expect(open.modeRow.open).toBe(true);
    expect({ ...open, modeRow: narrow.modeRow }, 'unfolding re-plans nothing but the row').toEqual(narrow);
    const wide = planFrame(1280 / ZOOM, 800 / ZOOM, { ...options, rowOpen: true });
    expect(wide.modeRow.folded, 'a row that fits never folds').toBeUndefined();
    // A phone held sideways under its address bar keeps the whole row at the touch default.
    expect(planFrame(832 / 0.75, 328 / 0.75, { ...options, inputMode: 'touch' }).modeRow.folded).toBeUndefined();
  });

  it('makes the same plan when the PC landscape defaults are passed explicitly', () => {
    for (const [vw, vh] of WINDOWS) {
      expect(planFrame(vw / ZOOM, vh / ZOOM, { ...options, shape: 'landscape', inputMode: 'pc' }))
        .toEqual(planFrame(vw / ZOOM, vh / ZOOM, options));
    }
  });
});
