import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { useChromeScale } from '../menu/scale';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { getCatalogItem } from '../../state/catalog';
import { getCell } from '../../core/model/grid-model';
import { rotateObjectAction, peelTerrainAction } from './object-actions';
import { deleteGroup, reportDeleteGroup } from './group-actions';
import { useT } from '../../i18n/context';
import { colors, radii, shadows, font, easing, springs, exitTransition, z, cursors } from '../styles';

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

export function ContextMenu() {
  const chrome = useChromeScale();
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
  const anim = {
    initial: { scale: 0.9, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    exit: { scale: 0.9, opacity: 0, transition: exitTransition },
    transition: springs.bouncy,
  };

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
        peelTerrainAction(executor, x, y, cell);
        useEditorStore.getState().clearSelection();
        close();
      };
      content = (
        <motion.div key="menu" data-context-menu {...anim} style={{ ...menuStyle, zoom: chrome, ...pos }}>
          <button
            style={{ ...itemStyle, color: colors.statusError, opacity: isGround ? 0.4 : 1, pointerEvents: isGround ? 'none' : 'auto' }}
            onMouseEnter={(e) => { if (!isGround) (e.currentTarget as HTMLElement).style.background = colors.surfaceSecondary; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={handleTerrainDelete}
          >
            {t('context.delete')}
          </button>
        </motion.div>
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
          if (rotateObjectAction(executor, gridState, useEditorStore.getState().eventBus, obj, angle, { from: obj.rotation, to: angle })) close();
        };
        const handleDelete = () => {
          // Routed through deleteGroup (with a single member) rather than removeObjectAction
          // directly, so a locked object reports the SAME refusal reportDeleteGroup gives a
          // group of only-locked members.
          const result = deleteGroup(executor, gridState, [obj.id]);
          reportDeleteGroup(useEditorStore.getState().eventBus, t, result);
          useEditorStore.getState().clearSelection();
          close();
        };
        content = (
          <motion.div key="menu" data-context-menu {...anim} style={{ ...menuStyle, zoom: chrome, ...pos }}>
            {item?.rotatable && (
              <>
                {ANGLES.map((a) => (
                  <button
                    key={a}
                    style={{ ...itemStyle, background: obj.rotation === a ? colors.surfaceSecondary : 'none' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surfaceSecondary; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = obj.rotation === a ? colors.surfaceSecondary : 'transparent'; }}
                    onClick={() => handleRotate(a)}
                  >
                    {obj.rotation === a && <span style={{ color: colors.accentPrimary }}>&#10003;</span>}
                    {t(`context.rotate_${a}`)}
                  </button>
                ))}
                <div style={dividerStyle} />
              </>
            )}
            <button
              style={{ ...itemStyle, color: colors.statusError }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = colors.surfaceSecondary; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={handleDelete}
            >
              {t('context.delete')}
            </button>
          </motion.div>
        );
      }
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
