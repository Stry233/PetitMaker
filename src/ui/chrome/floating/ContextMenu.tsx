/*
 * The menu a right-click on the map opens, or a long press in touch mode (`HoldRing.tsx` fills by
 * the finger until it does).
 *
 * The store holds which block was clicked and where; the rows it offers for that block and the card
 * they stand on are `objectMenuRows`/`terrainMenuRows` + `ContextMenuFace` below, so the Help
 * Center's figure of this menu is this menu rather than a drawing of it. One row list serves both
 * input modes, each row naming the modes it shows in: a finger's menu carries the selection card's
 * actions and the ways to move and multi-select that a mouse has in a drag and a modifier key.
 */
import { helpTargetAttr } from '../../session/help-targets';
import { Fragment, useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { TOUCH_TARGET } from '../../design/scale';
import { ChromeLifted } from '../../primitives/ChromeLifted';
import { motion, AnimatePresence, useIsPresent } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getCell } from '../../../core/model/grid-model';
import { deleteObjectConfirmed, peelTerrainAt, rotateObjectTo, selectionTarget } from '../../../editor/editing/group-edit';
import { latchMove, latchMultiSelect, pickObject, turnObjectQuarter } from '../../../editor/editing/object-menu';
import { turnsInSession } from '../../../editor/operations/planet-session';
import { isDraggableObject } from '../../../view/interaction/selection-hover';
import { localizedName, useLocale, useT } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import type { InputMode } from '../../../platform/device/input-mode';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { radii, font, z } from '../../design/styles';
import { LINE, PANEL_EDGE, PLATE, PLATE_INK, DANGER_INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { MoveIcon, MultiSelectIcon, PasteIcon, PickIcon, RotateIcon, TrashIcon } from '../../primitives/line-glyphs';
import { cellAtScreen, pasteAtCell } from '../../../editor/editing/clipboard';
import { pasteOffered } from '../../../state/clipboard';
import { Thumb } from './SelectionCard';
import { floatMenuHoverFill, floatMenuItemFill, floatMenuItemStyle } from '../../primitives/FloatMenu';
import { hoverFillMotion } from '../../primitives/hover-fill';
import { ROTATIONS, type Rotation } from '../../../core/model/types';
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
  /** The row's mark, which a finger's rows carry. */
  icon?: ReactNode;
  /** Removal, in the error ink. */
  danger?: boolean;
  /** The facing the piece already stands at: ticked, and filled the way a chosen row is. */
  current?: boolean;
  /** Nothing left to act on, so the row takes no press (a cell already down to bare ground). */
  inactive?: boolean;
  /** Draws a divider above this row. */
  separated?: boolean;
}

/** What a finger's menu offers on an object beyond what every menu does, from the selection card's rules. */
interface TouchMenuOffers { pickable: boolean; movable: boolean }


const PC: readonly InputMode[] = ['pc'];
const TOUCH: readonly InputMode[] = ['touch'];
const NEVER: readonly InputMode[] = [];

/**
 * What the menu offers on an object, for a mouse without `touch` and for a finger with it. A mouse
 * gets the four facings, where the piece turns at all, then removal. A finger gets the selection
 * card's turn and pick, then move, multi-select and removal, each row with its mark. Paste joins
 * both once something is copied (EDIT-56); Copy does not, since Pick arms one object again (EDIT-53).
 */
export function objectMenuRows(
  t: Resolver, rotation: number, rotatable: boolean, touch?: TouchMenuOffers, paste = false,
): ContextMenuRow[] {
  const mode: InputMode = touch ? 'touch' : 'pc';
  const rows: [readonly InputMode[], ContextMenuRow][] = [];
  if (rotatable) {
    for (const a of ROTATIONS) {
      rows.push([PC, { id: `rotate_${a}`, label: t(`context.rotate_${a}`), current: rotation === a }]);
    }
    rows.push([TOUCH, { id: 'rotate', label: t('a11y.rotate'), icon: <RotateIcon /> }]);
  }
  rows.push([touch?.pickable ? TOUCH : NEVER, { id: 'pick', label: t('a11y.pick_material'), icon: <PickIcon /> }]);
  rows.push([touch?.movable ? TOUCH : NEVER, { id: 'move', label: t('menu.move'), icon: <MoveIcon /> }]);
  rows.push([TOUCH, { id: 'multi_select', label: t('shortcut.multi_select'), icon: <MultiSelectIcon /> }]);
  const both = [...PC, ...TOUCH];
  rows.push([paste ? both : NEVER, { id: 'paste', label: t('context.paste'), separated: rotatable && !touch, ...(touch ? { icon: <PasteIcon /> } : {}) }]);
  rows.push([both, {
    id: 'delete', label: t('context.delete'), danger: true, separated: (rotatable || paste) && !touch, ...(touch ? { icon: <TrashIcon /> } : {}),
  }]);
  return rows.filter(([modes]) => modes.includes(mode)).map(([, row]) => row);
}

/** What it offers on a terrain cell: Paste once something is copied, and removal, which peels one
 *  layer. */
export function terrainMenuRows(t: Resolver, isGround: boolean, paste = false, touch = false): ContextMenuRow[] {
  const rows: ContextMenuRow[] = [];
  if (paste) rows.push({ id: 'paste', label: t('context.paste'), ...(touch ? { icon: <PasteIcon /> } : {}) });
  rows.push({ id: 'delete', label: t('context.delete'), danger: true, inactive: isGround, separated: paste && !touch, ...(touch && paste ? { icon: <TrashIcon /> } : {}) });
  return rows;
}

/** The head of a finger's menu: the object's picture and name over a rule. Nothing hovers in touch
 *  mode, so a long name wraps in full rather than ending in an ellipsis. */
export function MenuHeader({ item, name }: { item: ReturnType<typeof getCatalogItem>; name: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 10px', marginBottom: 4, borderBottom: `1px solid ${LINE}` }}>
      <Thumb {...(item?.icon ? { src: iconUrl(item.icon) } : {})} {...(item?.color ? { color: item.color } : {})} />
      <span data-testid="context-menu-name" style={{ ...roleFont('head'), color: PLATE_INK, maxWidth: 220, lineHeight: 1.15, overflowWrap: 'break-word' }}>{name}</span>
    </div>
  );
}

/** The menu itself: the card, its rows and their hover. `style` carries the position and the scale
 *  the card draws at; `header` stands over the rows, and `touch` raises each row to a fingertip.
 *  A row acts on a press that began on the menu, or on a key: the release ending the long press
 *  that opened the menu under the finger chooses nothing. */
export function ContextMenuFace({ rows, onPick, style, anchor, zoom = 1, onDismiss, header, touch = false }: {
  anchor?: { x: number; y: number };
  zoom?: number;
  onDismiss?: () => void;
  rows: readonly ContextMenuRow[];
  onPick: (id: string) => void;
  style?: CSSProperties;
  header?: ReactNode;
  touch?: boolean;
}) {
  const present = useIsPresent();
  const floating = useFloatingPosition({ open: !!anchor && present, anchor: anchor ?? { x: 0, y: 0 }, zoom, overlap: touch });
  useSurfaceScope({ open: !!onDismiss && present && !!floating.placement, root: floating.ref, onClose: onDismiss ?? (() => {}), focus: 'menu', outside: true });
  const pressedHere = useRef(false);
  useEffect(() => { pressedHere.current = false; }, [anchor?.x, anchor?.y]);
  return (
    <motion.div ref={floating.ref} {...floating.piece} role="menu" tabIndex={-1} {...helpTargetAttr('select', 'select-menu')} data-context-menu {...anim}
      onPointerDownCapture={() => { pressedHere.current = true; }}
      style={{ ...menuStyle, ...style, ...(anchor ? floating.style : {}) }}>
      {header}
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
              ...(touch ? { minHeight: TOUCH_TARGET, gap: 12 } : {}),
            }}
            onClick={(e) => { if (e.detail === 0 || pressedHere.current) onPick(row.id); }}
          >
            {row.icon}
            {row.label}
          </motion.button>
        </Fragment>
      ))}
    </motion.div>
  );
}

export function ContextMenu() {
  const t = useT();
  const menu = useEditorStore((s) => s.contextMenu);
  // The rows and their size follow the press that opened the menu, whatever the input mode becomes
  // while it stands; a finger's rows reach a fingertip.
  const touch = menu?.mode === 'touch';
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);
  const inSession = useEditorStore((s) => s.planetSession !== null);
  const canPaste = useEditorStore(pasteOffered);
  const locale = useLocale();

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
  /** One copy with its top-left on the cell the menu was opened at (EDIT-56). */
  const pasteHere = () => {
    const cell = menu ? cellAtScreen(menu.x, menu.y) : null;
    if (cell) pasteAtCell(cell);
    close();
  };

  // Build the menu content (or null) so AnimatePresence can play a close-exit.
  let content: ReactElement | null = null;
  if (menu && gridState && executor) {
    // menu.x/y are visual px (pointer event); the css coords live under the zoom, so divide it out.
    const anchor = { x: menu.x, y: menu.y };
    if (menu.target.kind === 'terrain') {
      const { x, y } = menu.target;
      const cell = getCell(gridState.cells, x, y);
      const isGround = !cell?.terrain;
      const handleTerrainPick = (id: string) => {
        if (id === 'paste') { pasteHere(); return; }
        if (isGround) return;
        peelTerrainAt(x, y);
        close();
      };
      content = (
        <ChromeLifted key="menu" control={TOUCH_TARGET} touch={touch}>
          {({ zoom: chrome, weights }) => (
            <ContextMenuFace
              rows={terrainMenuRows(t, isGround, canPaste, touch)}
              onPick={handleTerrainPick}
              touch={touch}
              anchor={anchor} zoom={chrome} onDismiss={close}
              style={{ zoom: chrome, ...weights }}
            />
          )}
        </ChromeLifted>
      );
    } else {
      const obj = gridState.objects.get(menu.target.id);
      if (obj) {
        const item = getCatalogItem(obj.catalogId);
        const sessionLandmark = turnsInSession(obj, inSession);
        // A refused angle leaves the menu open on the object as it was.
        const handleRotate = (angle: Rotation) => { if (rotateObjectTo(obj, angle)) close(); };
        const handleDelete = () => { deleteObjectConfirmed(t, obj.id); close(); };
        // A finger's menu offers what the selection card would for this object alone.
        const card = touch ? selectionTarget([menu.target], gridState, inSession) : null;
        const offers = touch ? { pickable: !!card?.pickable, movable: isDraggableObject(obj) } : undefined;
        const name = item ? localizedName(item.name, locale) : obj.catalogId;
        content = (
          <ChromeLifted key="menu" control={TOUCH_TARGET} touch={touch}>{({ zoom: chrome, weights }) => (
          <ContextMenuFace
            rows={objectMenuRows(t, obj.rotation, touch ? !!card?.rotatable : sessionLandmark || !!item?.rotatable, offers, canPaste)}
            onPick={(id) => {
              if (id === 'delete') { handleDelete(); return; }
              if (id === 'paste') { pasteHere(); return; }
              // The finger's turn is the selection card's quarter turn, and the menu stays for the next one.
              if (id === 'rotate') { turnObjectQuarter(obj.id); return; }
              if (id === 'pick') { pickObject(obj.id); close(); return; }
              if (id === 'move') { latchMove(obj.id); close(); return; }
              if (id === 'multi_select') { latchMultiSelect(obj.id); close(); return; }
              handleRotate(Number(id.slice('rotate_'.length)) as Rotation);
            }}
            anchor={anchor} zoom={chrome} onDismiss={close}
            touch={touch}
            {...(touch ? { header: <MenuHeader item={item} name={name} /> } : {})}
            style={{ zoom: chrome, ...weights }}
          />
          )}</ChromeLifted>
        );
      }
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
