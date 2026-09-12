/** The star arms the surface action; a picker appears only when there is a choice. */
import { useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { offerSmartBuild } from '../../../core/runtime/smart-build';
import { useT } from '../../../i18n/context';
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

  const press = useCallback((action: SmartAction) => {
    setEditMode({ tool: 'smart', macro: action.id });
  }, [setEditMode]);

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
      carries={open && actions.length > 1 ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {actions.map((action) => (
            <Segment
              key={action.id}
              action={action}
              armed={armedMacro === action.id}
              onPress={() => press(action)}
            />
          ))}
        </span>
      ) : undefined}
    />
  );
}
