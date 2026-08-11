/*
 * ScopeScreen.tsx — where a generation may act, painted.
 *
 * IT IS A SCREEN, NOT A STATE OF THE SHELF. Pressing the scope chip replaces the generate shelf
 * with this and Done brings the shelf back with a fresh batch. That is the whole reason it is a
 * screen: every candidate is stale the moment the region changes, so leaving the cards up would
 * show a promise the next stroke breaks and coming back to the same ones would be a lie. A screen
 * says you are leaving and returning to a new batch.
 *
 * IT WEARS THE TERRAIN BAR'S LAYOUT EXACTLY: one row of tool cells at the same size with the same
 * shortcut keys (`ToolCell`, `scope-cells.ts`), the brush slider at the right on the view kit's own
 * edge, and the three things a painted region needs — select all, clear, done. There is no second
 * band, because there is nothing to pick.
 *
 * DONE SAYS DONE. The count belongs to the scope chip in the strip, which keeps saying it once the
 * cards are back — that is what makes it a chip rather than a tab — so carrying it here too would
 * say it twice, once on a control that disappears.
 *
 * The cells it collects are the region brush's (`ui/shell/use-region-brush`), which is mounted by
 * the shell and registered on the pointer machine's own channel: this screen arms nothing and
 * paints nothing itself. It asks that buffer for the two whole-region edits through the same
 * channel, so a Clear here is one entry on the region's own undo stack rather than a silent write.
 */
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { clearRegionSelection, selectWholeRegion } from '../../../core/runtime/region-brush';
import { useT } from '../../../i18n/context';
import { host } from '../../../kit/host';
import { useEditorStore } from '../../../state/store';
import { btnReset, buttonMotion, cursors, UNAVAILABLE, z } from '../../design/styles';
import { ACTIVE, PLATE, PLATE_INK } from '../../design/tokens';
import { EDGE_RIGHT, QUAD, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { BrushSizeSlider } from './BrushSizeSlider';
import { SCOPE_CELLS } from './scope-cells';
import { READOUT_SIZE, SLIDER_LIFT } from './TerrainBar';
import { CELL_BOX, ToolCell } from './ToolCell';

/** Room between the cells and the actions after them, in css px: wider than the row's own gap, so
 *  three words read as a group of their own rather than as three more cells. */
const ACTION_GAP = 22;

/** One of the three actions: a pill as tall as a cell, so it stands IN the row rather than beside
 *  it. `primary` is the one that ends the screen, in the yellow this frame marks a choice with. */
function Action({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  return (
    <motion.button
      type="button"
      {...buttonMotion}
      onClick={onPress}
      style={{
        ...btnReset, flex: 'none', pointerEvents: 'auto', cursor: cursors.clickable,
        height: CELL_BOX.h, padding: '0 18px', borderRadius: 999,
        background: primary ? ACTIVE : PLATE,
        display: 'flex', alignItems: 'center',
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText>
    </motion.button>
  );
}

export function ScopeScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const region = useEditorStore((s) => s.region);
  const tool = useEditorStore((s) => s.regionTool);
  const setTool = useEditorStore((s) => s.setRegionTool);
  const size = useEditorStore((s) => s.regionBrushSize);
  const setSize = useEditorStore((s) => s.setRegionBrushSize);

  /*
   * What is already painted, shown from the moment the screen opens: the overlay is imperative, so
   * arriving with a region in the store and nothing on the map would hide the thing being edited.
   *
   * DONE DOES NOT TAKE IT DOWN. The region survives this screen — it is the scope the next run acts
   * on — and seeing it on the map is how a person knows where a generation will land. So there is no
   * unmount cleanup here: closing the screen is not the end of the region, only the end of editing
   * it.
   *
   * WHAT DOES TAKE IT DOWN IS A GENERATION: once a run has landed, the question the highlight
   * answered — where will this land? — is answered by the generation itself, and in 3D the decal
   * would anyway be stranded at the surface heights it was drawn against. The shelf clears it in
   * both views; the scope itself stays in the store, and reopening this screen shows it again.
   *
   * The empty case IS a clear, not a skip: a region painted down to nothing is a region that should
   * not be drawn, and skipping the call left the last one standing on the map.
   */
  useEffect(() => {
    if (region.length > 0) host.buildableRegion.show(region);
    else host.buildableRegion.clear();
  }, [region]);

  const sized = SCOPE_CELLS.find((cell) => cell.tool === tool)?.sized === true;
  return (
    <div
      data-testid="shell-scope-screen"
      style={{
        position: 'fixed', left: QUAD.left, right: EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        display: 'flex', flexDirection: 'column',
        // The column spans the window, so it must let a press through everywhere it is not a
        // control; each control below claims its own pointer events.
        pointerEvents: 'none',
      }}
    >
      {/* `flex-start` is the BOTTOM here: `wrap-reverse` swaps the cross axis's two ends, so a row
          hanging off the window's bottom edge and growing upward aligns with the start it flipped. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: QUAD.gap, flexWrap: 'wrap-reverse' }}>
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap-reverse', gap: QUAD.gap,
            flex: '0 1 auto', minWidth: 0,
          }}
        >
          {SCOPE_CELLS.map((cell, i) => (
            <ToolCell
              key={cell.tool}
              glyph={cell.glyph}
              label={t(cell.labelKey)}
              commandId={cell.commandId}
              active={cell.tool === tool}
              centre={QUAD.left + i * (CELL_BOX.w + QUAD.gap) + CELL_BOX.w / 2}
              onSelect={() => setTool(cell.tool)}
            />
          ))}

          <span style={{ display: 'flex', alignItems: 'center', gap: QUAD.gap, marginLeft: ACTION_GAP - QUAD.gap }}>
            <Action label={t('gen.select_all')} onPress={selectWholeRegion} />
            <Action label={t('generate.clear')} onPress={clearRegionSelection} />
            {/* DONE, AND NOTHING ELSE. A button says what pressing it does; the count belongs to the
                scope chip in the strip, which keeps saying it once the cards are back. That is what
                makes it a chip rather than a tab, and it is why saying it here too would be saying
                it twice, once on a control that disappears. */}
            <Action label={t('gen.scope_done')} primary onPress={onDone} />
          </span>
        </div>

        {/* The far end of the same line, on the frame's own right margin: a slider in this interface
            stands where the view kit's column does, and this is the terrain bar's own slider. */}
        <div
          style={{
            flex: 'none', marginLeft: 'auto', marginBottom: SLIDER_LIFT,
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: sized ? 1 : UNAVAILABLE,
          }}
        >
          <BarText size={READOUT_SIZE} onMap weight={900}>
            {t(size === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: size })}
          </BarText>
          <BrushSizeSlider value={size} onChange={setSize} disabled={!sized} />
        </div>
      </div>
    </div>
  );
}
