/*
 * The menu a right-click on the map opens.
 *
 * The store holds which block was clicked and where; the rows it offers for that block and the card
 * they stand on are `objectMenuRows`/`terrainMenuRows` + `ContextMenuFace` below, so the Help
 * Center's figure of this menu is this menu rather than a drawing of it.
 */
import { helpTargetAttr } from '../../session/help-targets';
import { Fragment, useEffect, type CSSProperties, type ReactElement } from 'react';
import { useChromeScale, useTouchPrimary, useWeightVars } from '../../design/scale';
import { motion, AnimatePresence, useIsPresent } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getCell } from '../../../core/model/grid-model';
import { deleteObjectConfirmed, peelTerrainAt, rotateObjectTo } from '../../../editor/editing/group-edit';
import { turnsInSession } from '../../../editor/operations/planet-session';
import { useT } from '../../../i18n/context';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { radii, font, z } from '../../design/styles';
import { LINE, PANEL_EDGE, PLATE, PLATE_INK, DANGER_INK } from '../../design/tokens';
import { floatMenuHoverFill, floatMenuItemFill, floatMenuItemStyle } from '../../primitives/FloatMenu';
import { hoverFillMotion } from '../../primitives/hover-fill';
import type { Rotation } from '../../../core/model/types';
import { ROTATIONS } from '../../../core/model/types';
import { framerMotion } from '../../design/motion';
import type { Translate } from '../../../i18n/keys';

// The map's menu wears the floating-menu card: the cream plate with the hairline every panel over
// the map wears, rows that tint one step down the cream ramp on hover, and the chosen row in the
// active fill.
const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: z.contextMenu,
  background: PLATE,
  border: PANEL_EDGE,
  borderRadius: radii.lg,
  boxShadow: 'none',
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 160, width: 'max-content',
  fontFamily: font.family,
  color: PLATE_INK,
  transformOrigin: 'top left', // scale grows from the click point (Framer enter/exit)
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: LINE,
  margin: '4px 8px',
};

const anim = {
  initial: { scale: 0.94, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.94, opacity: 0, transition: framerMotion('surface.leave') },
  transition: framerMotion('surface.arrive'),
};

type Resolver = Translate;

/** One row of the menu: the words on it, and how it stands. */
interface ContextMenuRow {
  id: string;
  label: string;
  /** Removal, in the error ink. */
  danger?: boolean;
  /** The facing the piece already stands at: ticked, and filled the way a chosen row is. */
  current?: boolean;
  /** Nothing left to act on, so the row takes no press (a cell already down to bare ground). */
  inactive?: boolean;
  /** Draws a divider above this row. */
  separated?: boolean;
}

/** What the menu offers on an object: the four facings, where the piece turns at all, then removal. */
export function objectMenuRows(t: Resolver, rotation: number, rotatable: boolean): ContextMenuRow[] {
  const rows: ContextMenuRow[] = [];
  if (rotatable) {
    for (const a of ROTATIONS) {
      rows.push({ id: `rotate_${a}`, label: t(`context.rotate_${a}`), current: rotation === a });
    }
  }
  rows.push({ id: 'delete', label: t('context.delete'), danger: true, separated: rotatable });
  return rows;
}

/** What it offers on a terrain cell: removal alone, which peels one layer. */
export function terrainMenuRows(t: Resolver, isGround: boolean): ContextMenuRow[] {
  return [{ id: 'delete', label: t('context.delete'), danger: true, inactive: isGround }];
}

/** The menu itself: the card, its rows and their hover. `style` carries the position and the scale
 *  the card draws at. */
export function ContextMenuFace({ rows, onPick, style, anchor, zoom = 1, onDismiss }: {
  anchor?: { x: number; y: number };
  zoom?: number;
  onDismiss?: () => void;
  rows: readonly ContextMenuRow[];
  onPick: (id: string) => void;
  style?: CSSProperties;
}) {
  const present = useIsPresent();
  const floating = useFloatingPosition({ open: !!anchor && present, anchor: anchor ?? { x: 0, y: 0 }, zoom });
  useSurfaceScope({ open: !!onDismiss && present && !!floating.placement, root: floating.ref, onClose: onDismiss ?? (() => {}), focus: 'menu', outside: true });
  return (
    <motion.div ref={floating.ref} role="menu" tabIndex={-1} {...helpTargetAttr('select')} data-context-menu {...anim} style={{ ...menuStyle, ...style, ...(anchor ? floating.style : {}) }}>
      {rows.map((row) => (
        <Fragment key={row.id}>
          {row.separated ? <div style={dividerStyle} /> : null}
          <motion.button type="button" role="menuitem" disabled={row.inactive}
            aria-current={row.current || undefined}
            {...hoverFillMotion({ fill: floatMenuItemFill(!!row.current), hoverFill: row.inactive || row.current ? undefined : floatMenuHoverFill(false) })}
            transition={framerMotion('surface.arrive')}
            style={{
              ...floatMenuItemStyle(!!row.current, row.inactive),
              ...(row.danger ? { color: DANGER_INK } : {}),
              ...(row.inactive ? { pointerEvents: 'none' } : {}),
            }}
            onClick={() => onPick(row.id)}
          >
            {row.label}
          </motion.button>
        </Fragment>
      ))}
    </motion.div>
  );
}

export function ContextMenu() {
  // A fingertip gets the rows at their designed size at least.
  const touch = useTouchPrimary();
  const scale = useChromeScale();
  const chrome = touch ? Math.max(scale, 1) : scale;
  const weights = useWeightVars();
  const t = useT();
  const menu = useEditorStore((s) => s.contextMenu);
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);
  const inSession = useEditorStore((s) => s.planetSession !== null);

  // Any pan/zoom moves the map out from under the menu's fixed screen position;
  // a transient menu dismisses on viewport movement.
  const eventBus = useEditorStore((s) => s.eventBus);
  useEffect(() => {
    if (!menu) return;
    const close = () => useEditorStore.getState().setContextMenu(null);
    eventBus.on('viewport-changed', close);
    return () => eventBus.off('viewport-changed', close);
  }, [menu, eventBus]);

  const close = () => useEditorStore.getState().setContextMenu(null);

  // Build the menu content (or null) so AnimatePresence can play a close-exit.
  let content: ReactElement | null = null;
  if (menu && gridState && executor) {
    // menu.x/y are visual px (pointer event); the css coords live under the zoom, so divide it out.
    const anchor = { x: menu.x, y: menu.y };
    if (menu.target.kind === 'terrain') {
      const { x, y } = menu.target;
      const cell = getCell(gridState.cells, x, y);
      const isGround = !cell?.terrain;
      const handleTerrainDelete = () => {
        if (isGround) return;
        peelTerrainAt(x, y);
        close();
      };
      content = (
        <ContextMenuFace
          key="menu"
          rows={terrainMenuRows(t, isGround)}
          onPick={handleTerrainDelete}
          anchor={anchor} zoom={chrome} onDismiss={close}
          style={{ zoom: chrome, ...weights }}
        />
      );
    } else {
      const obj = gridState.objects.get(menu.target.id);
      if (obj) {
        const item = getCatalogItem(obj.catalogId);
        const sessionLandmark = turnsInSession(obj, inSession);
        // A refused angle leaves the menu open on the object as it was.
        const handleRotate = (angle: Rotation) => { if (rotateObjectTo(obj, angle)) close(); };
        const handleDelete = () => { deleteObjectConfirmed(t, obj.id); close(); };
        content = (
          <ContextMenuFace
            key="menu"
            rows={objectMenuRows(t, obj.rotation, sessionLandmark || !!item?.rotatable)}
            onPick={(id) => {
              if (id === 'delete') { handleDelete(); return; }
              handleRotate(Number(id.slice('rotate_'.length)) as Rotation);
            }}
            anchor={anchor} zoom={chrome} onDismiss={close}
          style={{ zoom: chrome, ...weights }}
          />
        );
      }
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
