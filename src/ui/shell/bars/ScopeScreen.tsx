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
import { useFrameLayout } from '../frame-layout';
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { clearRegionSelection } from '../../../core/runtime/region-brush';
import { ToolRow } from './ToolRow';
import { cssMotion } from '../motion/use-motion';
import { useT } from '../../../i18n/context';
import { host } from '../../../kit/host';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { btnReset, buttonMotion, cursors, UNAVAILABLE, z } from '../../design/styles';
import { ACTIVE, PLATE, PLATE_INK } from '../../design/tokens';
import { EDGE_RIGHT, QUAD, SCALE, TEXT } from '../units';
import { ScaleProvider } from '../../design/scale';
import { BarText } from './bar-atoms';
import { BrushSizeSlider } from './BrushSizeSlider';
import { SCOPE_CELLS } from './scope-cells';
import { setRegionMinSide, setRegionSingle } from '../../../core/runtime/region-brush';
import type { RegionTool } from '../../../core/model/types';
import { READOUT_SIZE, SLIDER_LIFT } from './BrushSizeSlider';
import { CELL_BOX, ToolCell } from './ToolCell';

/** Room between the cells and the actions after them, in css px: wider than the row's own gap, so
 *  three words read as a group of their own rather than as three more cells. */
const ACTION_GAP = 22;

/** One of the three actions: a pill as tall as a cell, so it stands IN the row rather than beside
 *  it. `primary` is the one that ends the screen, in the yellow this frame marks a choice with. */
export function Action({ label, primary, disabled, onPress }: {
  label: string; primary?: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : buttonMotion)}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onPress(); }}
      style={{
        ...btnReset, flex: 'none', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: CELL_BOX.h, padding: '0 18px', borderRadius: 999,
        background: primary ? ACTIVE : PLATE,
        display: 'flex', alignItems: 'center',
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText>
    </motion.button>
  );
}

interface ScopeScreenProps {
  onDone: () => void;
  /** The figures this screen may offer, or all of them when the caller has no preference
   *  (`scope-cells.ts:SCOPE_TOOLS_FOR`). */
  tools?: readonly RegionTool[];
  /** The shortest side the caller can work in, where it has one. Present, the region is ONE figure
   *  (a caller that fills a region cannot use two), and this screen says so while it is too small
   *  rather than letting Done be pressed on a selection the generator will refuse. */
  minSide?: number;
}

export function ScopeScreen(props: ScopeScreenProps) {
  return <ScaleProvider value={SCALE}><ScopeScreenBody {...props} /></ScaleProvider>;
}

function ScopeScreenBody({ onDone, tools, minSide }: ScopeScreenProps) {
  const layout = useFrameLayout();
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

  const cells = tools ? SCOPE_CELLS.filter((cell) => tools.includes(cell.tool)) : SCOPE_CELLS;
  const sized = cells.find((cell) => cell.tool === tool)?.sized === true;

  // The armed figure survives between visits, so a kind that offers fewer of them can be entered
  // with one it does not offer: the row would show nothing chosen while the pointer still painted
  // with it. Snap to the first one offered instead.
  useEffect(() => {
    if (cells.length > 0 && !cells.some((cell) => cell.tool === tool)) setTool(cells[0]!.tool);
  }, [cells, tool, setTool]);

  // A caller with a floor fills its region, so the region is one figure while this screen is up —
  // and the floor is HARD: the drags clamp to it, so a figure below it cannot be drawn.
  useEffect(() => {
    setRegionSingle(minSide !== undefined);
    setRegionMinSide(minSide ?? null);
    return () => { setRegionSingle(false); setRegionMinSide(null); };
  }, [minSide]);

  /** The selection's own extent, so the screen can say when it is short before Done is pressed. */
  const extent = useMemo(() => {
    if (region.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of region) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    return Math.min(maxX - minX + 1, maxY - minY + 1);
  }, [region]);
  const tooSmall = minSide !== undefined && extent !== null && extent < minSide;
  return (
    <div
      data-testid="shell-scope-screen"
      {...helpTargetAttr('region')}
      style={{
        position: 'fixed', left: QUAD.left, right: layout?.edgeRight ?? EDGE_RIGHT, bottom: QUAD.bottom, zIndex: z.panel,
        transition: cssMotion('frame.layout.adapt', 'right'),
        display: 'flex', flexDirection: 'column',
        // The column spans the window, so it must let a press through everywhere it is not a
        // control; each control below claims its own pointer events.
        pointerEvents: 'none',
      }}
    >
      <ToolRow>
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', gap: QUAD.gap,
            flex: '0 0 auto', minWidth: 0,
          }}
        >
          {cells.map((cell, i) => (
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
            {/* No select-all beside it: an empty region already means the whole planet, so taking
                every cell and clearing are the same scope said two ways. */}
            <Action label={t('generate.clear')} onPress={clearRegionSelection} />
            {/* DONE, AND NOTHING ELSE. A button says what pressing it does; the count belongs to the
                scope chip in the strip, which keeps saying it once the cards are back. That is what
                makes it a chip rather than a tab, and it is why saying it here too would be saying
                it twice, once on a control that disappears. */}
            {/* SHORT SELECTIONS ARE REFUSED HERE, not after the screen closes onto blank cards: the
                region is the thing to change and this is where it is being changed. The word says
                what is wrong rather than only going pale. */}
            <Action
              label={tooSmall ? t('gen.scope_min', { n: minSide ?? 0 }) : t('gen.scope_done')}
              primary
              disabled={tooSmall}
              onPress={onDone}
            />
          </span>
        </div>

        {/* The far end of the same line, on the frame's own right margin: a slider in this interface
            stands where the view kit's column does, and this is the terrain bar's own slider. */}
        <div
          style={{
            flex: 'none', marginLeft: 'auto', marginTop: SLIDER_LIFT,
            display: 'flex', alignItems: 'center', gap: 14,
            opacity: sized ? 1 : UNAVAILABLE,
          }}
        >
          <BarText size={READOUT_SIZE} onMap weight={900}>
            {t(size === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: size })}
          </BarText>
          <BrushSizeSlider value={size} onChange={setSize} disabled={!sized} />
        </div>
      </ToolRow>
    </div>
  );
}
