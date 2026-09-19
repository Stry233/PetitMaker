import { helpTargetAttr } from '../modals/help/targets';
/*
 * ContextMenu.tsx — the menu a right-click on the map opens.
 *
 * The store holds WHICH block was clicked and where; the rows it offers for that block and the card
 * they stand on are `objectMenuRows`/`terrainMenuRows` + `ContextMenuFace` below, so the Help
 * Center's figure of this menu is this menu rather than a drawing of it.
 */
import { Fragment, useEffect, type CSSProperties, type ReactElement } from 'react';
import { useChromeScale, useWeightVars } from '../../design/scale';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getCell } from '../../../core/model/grid-model';
import { peelTerrain } from '../../../tools/objects';
import { rotateObjectAction, deleteSelection } from '../../../kit/group-edit';
import { useT } from '../../../i18n/context';
import { colors, radii, shadows, font, easing, springs, exitTransition, z, cursors } from '../../design/styles';

const ANGLES = [0, 90, 180, 270] as const;

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: z.contextMenu,
  background: colors.surfacePrimary,
  borderRadius: radii.md,
  boxShadow: shadows.s2,
  padding: '4px 0',
  minWidth: 160,
  ...font.body,
  color: colors.textPrimary,
  transformOrigin: 'top left', // scale grows from the click point (Framer enter/exit)
};

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  background: 'none',
  border: 'none',
  cursor: cursors.clickable,
  ...font.body,
  color: colors.textPrimary,
  transition: `background 120ms ${easing.punchy}`,
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: colors.surfaceSecondary,
  margin: '4px 0',
};

const anim = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.9, opacity: 0, transition: exitTransition },
  transition: springs.bouncy,
};

type Resolver = (key: string) => string;

/** One row of the menu: the words on it, and how it stands. */
export interface ContextMenuRow {
  id: string;
  label: string;
  /** Removal, in the error ink. */
  danger?: boolean;
  /** The facing the piece already stands at: ticked, and filled the way a chosen row is. */
  current?: boolean;
  /** Nothing left to act on, so the row takes no press (a cell already down to bare ground). */
  inactive?: boolean;
  /** Draws a divider ABOVE this row. */
  separated?: boolean;
}

/** What the menu offers on an OBJECT: the four facings, where the piece turns at all, then removal. */
export function objectMenuRows(t: Resolver, rotation: number, rotatable: boolean): ContextMenuRow[] {
  const rows: ContextMenuRow[] = [];
  if (rotatable) {
    for (const a of ANGLES) {
      rows.push({ id: `rotate_${a}`, label: t(`context.rotate_${a}`), current: rotation === a });
    }
  }
  rows.push({ id: 'delete', label: t('context.delete'), danger: true, separated: rotatable });
  return rows;
}

/** What it offers on a TERRAIN cell: removal alone, which peels one layer. */
export function terrainMenuRows(t: Resolver, isGround: boolean): ContextMenuRow[] {
  return [{ id: 'delete', label: t('context.delete'), danger: true, inactive: isGround }];
}

/** The menu itself: the card, its rows and their hover. `style` carries the position and the scale
 *  the card draws at. */
export function ContextMenuFace({ rows, onPick, style }: {
  rows: readonly ContextMenuRow[];
  onPick: (id: string) => void;
  style?: CSSProperties;
}) {
  return (
    <motion.div {...helpTargetAttr('select')} data-context-menu {...anim} style={{ ...menuStyle, ...style }}>
      {rows.map((row) => {
        const rest = row.current ? colors.surfaceSecondary : 'transparent';
        return (
          <Fragment key={row.id}>
            {row.separated ? <div style={dividerStyle} /> : null}
            <button
              style={{
                ...itemStyle,
                ...(row.danger ? { color: colors.statusError } : {}),
                background: row.current ? colors.surfaceSecondary : 'none',
                ...(row.inactive ? { opacity: 0.4, pointerEvents: 'none' } : {}),
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surfaceSecondary; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = rest; }}
              onClick={() => onPick(row.id)}
            >
              {row.current && <span style={{ color: colors.accentPrimary }}>&#10003;</span>}
              {row.label}
            </button>
          </Fragment>
        );
      })}
    </motion.div>
  );
}

export function ContextMenu() {
  const chrome = useChromeScale();
  const weights = useWeightVars();
  const t = useT();
  const menu = useEditorStore((s) => s.contextMenu);
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);

  // Any pan/zoom moves the map out from under the menu's fixed screen position;
  // a transient menu dismisses on viewport movement.
  const eventBus = useEditorStore((s) => s.eventBus);
  useEffect(() => {
    if (!menu) return;
    const close = () => useEditorStore.getState().setContextMenu(null);
    eventBus.on('viewport-changed', close);
    return () => eventBus.off('viewport-changed', close);
  }, [menu, eventBus]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: MouseEvent) => {
      // containment by attribute, NOT a React ref: a ref on the AnimatePresence
      // child makes framer-motion's PopChild read child.ref, which React 18.3+
      // warns about ("`ref` is not a prop"). closest() keeps the exact behavior
      // (clicks inside the menu, padding included, never dismiss).
      if (!(e.target as Element | null)?.closest?.('[data-context-menu]')) {
        useEditorStore.getState().setContextMenu(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditorStore.getState().setContextMenu(null);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', escape);
    };
  }, [menu]);

  const close = () => useEditorStore.getState().setContextMenu(null);

  // Build the menu content (or null) so AnimatePresence can play a close-exit.
  let content: ReactElement | null = null;
  if (menu && gridState && executor) {
    // menu.x/y are VISUAL px (pointer event); the css coords live under the zoom, so divide it out.
    const pos = { left: menu.x / chrome, top: menu.y / chrome };
    if (menu.target.kind === 'terrain') {
      const { x, y } = menu.target;
      const cell = getCell(gridState.cells, x, y);
      const isGround = !cell?.terrain;
      const handleTerrainDelete = () => {
        if (isGround) return;
        peelTerrain(executor, x, y, cell);
        useEditorStore.getState().clearSelection();
        close();
      };
      content = (
        <ContextMenuFace
          key="menu"
          rows={terrainMenuRows(t, isGround)}
          onPick={handleTerrainDelete}
          style={{ zoom: chrome, ...weights, ...pos }}
        />
      );
    } else {
      const obj = gridState.objects.get(menu.target.id);
      if (obj) {
        const item = getCatalogItem(obj.catalogId);
        const handleRotate = (angle: 0 | 90 | 180 | 270) => {
          if (obj.rotation === angle) { close(); return; }
          // Validate the rotated footprint BEFORE touching the object. If the new
          // angle would overlap/leave the map, surface the error and leave the
          // object unchanged (never remove it on a doomed rotation).
          const result = rotateObjectAction(executor, gridState, useEditorStore.getState().eventBus, obj, angle, { from: obj.rotation, to: angle });
          if (result.ok) close();
        };
        const handleDelete = () => {
          // Routed through deleteSelection (with a single member) rather than removeObject
          // directly, so a locked object reports the SAME refusal a group of only-locked
          // members gets.
          deleteSelection(executor, gridState, useEditorStore.getState().eventBus, t, [obj.id]);
          useEditorStore.getState().clearSelection();
          close();
        };
        content = (
          <ContextMenuFace
            key="menu"
            rows={objectMenuRows(t, obj.rotation, !!item?.rotatable)}
            onPick={(id) => {
              if (id === 'delete') { handleDelete(); return; }
              handleRotate(Number(id.slice('rotate_'.length)) as 0 | 90 | 180 | 270);
            }}
            style={{ zoom: chrome, ...weights, ...pos }}
          />
        );
      }
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
