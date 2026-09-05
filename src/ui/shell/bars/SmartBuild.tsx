/*
 * SmartBuild.tsx — the last cell of the tool row, and the macro tool it arms.
 *
 * IT ARMS A TOOL, exactly as the seven cells beside it do: the store's `editMode` carries
 * `tool: 'smart'` plus the macro's id, `resolveEditMode` answers with the macro tool, and from
 * there the pointer machine owns everything — aiming, the ghost, panning and orbiting while armed,
 * Escape, the forbidden badge. This cell only chooses.
 *
 * THE CHOICES ARE VISIBLE. Open, the cell grows into the pill every chosen cell grows into
 * (`ToolCell` carries it), and the actions stand in it as SEGMENTS — the armed one filled, the
 * others translucent — so what else the cell offers is read, never discovered by pressing a cycle
 * button. Each press arms; pressing the star again puts the pill away and the brush back.
 *
 * The road surface's SECOND segment (`roads`) is a WHOLE-MAP action with nothing to aim, so it
 * RUNS rather than arms: each press is one edit and one undo entry, over the painted region when
 * one stands, else the whole buildable map. PRESSING AGAIN OFFERS ANOTHER CANDIDATE, taking the
 * last press's own roads back first so the layouts are alternatives rather than a pile
 * (`kit/operations/road-press.ts` holds the seed and the ids between presses). Every other segment,
 * road-link included, aims: pressing arms the macro tool at a cell.
 */
import { useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { offerSmartBuild } from '../../../core/runtime/smart-build';
import { useT } from '../../../i18n/context';
import { currentKit } from '../../../kit/context';
import { host } from '../../../kit/host';
import { pressRoadNetwork } from '../../../kit/operations';
import { EMPTY_KEY } from '../../../tools/macros';
import { showToast } from '../../../core/runtime/toast-bus';
import { useEditorStore } from '../../../state/store';
import { btnReset, buttonMotion, cursors } from '../../design/styles';
import { PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { BarText } from './bar-atoms';
import { SMART, SMART_MENU, type SmartAction } from './smart-menu';
import { ToolCell } from './ToolCell';
import type { TerrainSurface } from './terrain-cells';

/** One action in the open pill, filled while armed and translucent otherwise. */
function Segment({ action, armed, onPress }: {
  action: SmartAction;
  armed: boolean;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <motion.button
      type="button"
      {...buttonMotion}
      aria-label={t(action.labelKey)}
      aria-pressed={armed}
      onClick={(e) => { e.stopPropagation(); onPress(); }}
      style={{
        // The bar's column is hit-transparent and every control opts in — a segment without its
        // own `auto` is a button the pointer passes through.
        ...btnReset, pointerEvents: 'auto', cursor: cursors.clickable, borderRadius: 999,
        padding: '3px 10px', whiteSpace: 'nowrap',
        background: armed ? PLATE : `${PLATE}80`,
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK} align="left">{t(action.labelKey)}</BarText>
    </motion.button>
  );
}

export function SmartBuild({ surface, centre }: {
  surface: TerrainSurface;
  /** Where this cell's centre stands from the frame's left edge, so the name under it is kept on
   *  screen the same way the other seven are. */
  centre: number;
}) {
  const t = useT();
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const tool = useEditorStore((s) => s.editMode.tool);
  const armedMacro = useEditorStore((s) => s.armedMacro);
  const actions = SMART_MENU[surface];
  const open = tool === 'smart' && armedMacro !== null;

  // `roads` is the only action that runs rather than arms (see the file header), so this needs no
  // dispatch: everything else reaches `press`'s arming branch.
  const runRoads = useCallback(() => {
    const kit = currentKit();
    if (!kit) return;
    // The bar's own knobs are the macro's, and so is the SCOPE: a painted region binds this press
    // exactly as it binds the agent's `build_road_network` (`agent/tools/tools-director.ts`), which
    // is what makes "paint where, then press" one idea across both surfaces instead of two.
    const { tileMaterial, tileMaterialPicked, brushSize, region, autoEdgeCut } = useEditorStore.getState();
    // The SURFACE is the one knob the bar does not always hold an answer for: a road macro reads
    // the material off the map when nobody has picked one, so a new lane comes out matching the
    // street it grows from. Passing the store's standing default would override that on every
    // press, since something has to be armed for the tile brush whether or not anyone chose it.
    const { outcome, nth } = pressRoadNetwork(kit, {
      width: brushSize, trim: autoEdgeCut,
      ...(tileMaterialPicked ? { material: tileMaterial } : {}),
      ...(region.length > 0 ? { region } : {}),
    });
    host.resync();
    // The roads appearing are their own feedback. FOUR things the map cannot show for itself: a
    // press that laid NOTHING (reported in the refusal's OWN words); a press that laid a network and
    // still left a building unreached, which reads as success from the bar because the roads did
    // appear, just not at that door; a WIDE road that necked around a standing planting somewhere
    // along its length — the press is made from the bar, the pinch can be anywhere on the island,
    // and a 3-wide road with one 1-wide cell reads as a 3-wide road; and a press that REPLACED the
    // last one, since on a large island the difference between two candidates is easy to miss and
    // "nothing happened" is the wrong thing to conclude.
    if (outcome.changes === 0) showToast(t(EMPTY_KEY[outcome.code ?? 'nothing-to-connect']), 'warning');
    else if (outcome.code) showToast(t(EMPTY_KEY[outcome.code]), 'warning');
    else if (outcome.narrowedByPlanting) showToast(t('smart.road_necked'), 'info');
    else if (nth > 1) showToast(t('smart.roads_another', { n: nth }), 'info');
  }, [t]);

  const press = useCallback((action: SmartAction) => {
    if (action.aim) setEditMode({ tool: 'smart', macro: action.id });
    else runRoads();
  }, [runRoads, setEditMode]);

  const toggle = useCallback(() => {
    if (open) setEditMode({ tool: 'brush', macro: null });
    else press(actions[0]!);
  }, [open, press, actions, setEditMode]);

  // The key does what the cell does, both ways. Offered while this cell is mounted, since the row
  // it sits in is a surface's and there is no cell to press without one.
  useEffect(() => offerSmartBuild(toggle), [toggle]);

  return (
    <ToolCell
      glyph={SMART.cellGlyph}
      label={t('smart.build')}
      commandId={SMART.commandId}
      active={open}
      centre={centre}
      onSelect={toggle}
      helpTarget="smart"
      carries={open ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {actions.map((action) => (
            <Segment
              key={action.id}
              action={action}
              armed={action.aim && armedMacro === action.id}
              onPress={() => press(action)}
            />
          ))}
        </span>
      ) : undefined}
    />
  );
}
