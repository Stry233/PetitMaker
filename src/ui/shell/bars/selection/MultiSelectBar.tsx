/**
 * Touch multi-select's surfaces, standing while the latch is on (`state/slices/edit.ts`): a plate
 * over the map with the count and Done, and in the bar's place a row of what the group can do
 * (turn, move, select all, copy, delete). Upright the row is the cream panel the bar raises; on a wide
 * window it stands on the cream band where a shelf would.
 */
import { type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { selectedObjectIds } from '../../../../state/selection';
import { copyAllowed } from '../../../../state/clipboard';
import { btnReset, cursors, radii, SPACE } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { ACTIVE, DANGER_INK, INSET, PLATE_INK } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { CheckIcon, DuplicateIcon, MoveIcon, RotateIcon, SelectAllIcon, TrashIcon } from '../../../primitives/line-glyphs';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { TouchReach } from '../../../primitives/TouchReach';
import { MapPlate, plateButton } from '../../planet/MapPlate';
import { useRunCommand } from '../../use-shell-commands';
import { useFrameZoom } from '../../use-frame-zoom';
import { SHELF_TABS } from '../../units';
import { PanelTone, useBarSurface } from '../bar-panel';

/** An action tile: its mark over its name (C3), never narrower than `minW` nor wider than `maxW`. */
const TILE = { minW: 64, maxW: 120, h: 68 } as const;
const TICK = 18;

/** The count and Done, on the plate a task over the map wears. */
function MultiSelectPlate() {
  const t = useT();
  const locale = useLocale();
  const count = useEditorStore((s) => selectedObjectIds(s.selection).length);
  const end = useEditorStore((s) => s.clearSelection);
  return (
    <MapPlate title={t('selection.multi_count', quantityParams(locale, { n: count }))} testId="multi-select-plate">
      <ActionButton appearance="primary" interaction="pill" data-testid="multi-select-done" onClick={() => end()} style={plateButton}>
        <CheckIcon size={TICK} />
        {t('selection.done')}
      </ActionButton>
    </MapPlate>
  );
}

export function MultiSelectBar() {
  const t = useT();
  const run = useRunCommand();
  const zoom = useFrameZoom();
  const { upright, bar, root, reveal, tone, band, content } = useBarSurface('cream');
  const empty = useEditorStore((s) => s.selection.length === 0);
  // One object is armed again by Pick, so Copy waits for a second (EDIT-53).
  const single = useEditorStore((s) => s.selection.length < 2);
  const moving = useEditorStore((s) => s.moveLatched);
  const setMoveLatched = useEditorStore((s) => s.setMoveLatched);
  const canCopy = useEditorStore(copyAllowed);

  const tile = (on = false): CSSProperties => ({
    ...btnReset, position: 'relative', flex: '1 1 0', minWidth: TILE.minW, maxWidth: TILE.maxW, minHeight: TILE.h,
    padding: `${SPACE[4]}px ${SPACE[3]}px`, borderRadius: radii.field,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
    cursor: cursors.clickable, pointerEvents: 'auto', background: on ? ACTIVE : INSET, color: PLATE_INK,
  });
  const actions = [
    { id: 'rotate', label: t('a11y.rotate'), icon: <RotateIcon />, onPress: () => run('selection.rotate_cw'), off: empty },
    { id: 'move', label: t('menu.move'), icon: <MoveIcon />, onPress: () => setMoveLatched(!moving), off: empty, on: moving },
    { id: 'select-all', label: t('shortcut.select_all'), icon: <SelectAllIcon />, onPress: () => run('selection.all'), off: false },
    { id: 'copy', label: t('context.copy'), icon: <DuplicateIcon />, onPress: () => run('selection.copy'), off: single || !canCopy },
    { id: 'delete', label: t('a11y.delete'), icon: <TrashIcon />, onPress: () => run('selection.delete'), off: empty, danger: true },
  ];

  return (
    <>
      <MultiSelectPlate />
      <div data-testid="multi-select-bar" {...mapEdgeAttr('bottom')} {...root}>
        <PanelTone tone={tone}>
          {band}
          <motion.div
            {...content.centre}
            {...reveal}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SHELF_TABS.gap,
              ...(upright ? {} : { height: bar.height, padding: `0 ${SHELF_TABS.left}px` }),
            }}
          >
            {actions.map((a) => (
              <ActionButton
                key={a.id}
                interaction="tile"
                data-testid={`multi-select-${a.id}`}
                {...(a.id === 'delete' ? { 'data-selection-delete': '' } : {})}
                {...(a.on === undefined ? {} : { 'aria-pressed': a.on })}
                disabled={a.off}
                onClick={a.onPress}
                style={{ ...tile(a.on), ...(a.danger ? { color: DANGER_INK } : {}) }}
              >
                {a.icon}
                <span style={{ ...roleFont('label'), textAlign: 'center', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{a.label}</span>
                <TouchReach zoom={zoom} />
              </ActionButton>
            ))}
          </motion.div>
        </PanelTone>
      </div>
    </>
  );
}
