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
import type { ReactElement, ReactNode } from 'react';
import { TOUCH_TARGET } from '../../design/scale';
import { ChromeLifted } from '../../primitives/ChromeLifted';
import { AnimatePresence, usePresence } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { pressCommand } from '../../../editor/commands/run';
import { deleteMenuObject, latchMove, latchMultiSelect, menuTarget, turnObjectQuarter } from '../../../editor/editing/object-menu';
import { MAP_MENU_ENTRY } from '../../../editor/back/back-out';
import { localizedName, useLocale, useT } from '../../../i18n/context';
import { iconUrl } from '../../../assets/icon-urls';
import type { InputMode } from '../../../platform/device/input-mode';
import { z } from '../../design/styles';
import { LINE, PLATE_INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { MoveIcon, MultiSelectIcon, PasteIcon, PickIcon, RotateIcon, TrashIcon } from '../../primitives/line-glyphs';
import { cellAtScreen } from '../../../editor/editing/clipboard';
import { pasteOffered } from '../../../state/clipboard';
import { Thumb } from './SelectionCard';
import { FloatMenu } from '../../primitives/FloatMenu';
import type { HelpPageId } from '../../../editor/help/page-schema';
import { ROTATIONS, type Rotation } from '../../../core/model/types';
import type { Translate } from '../../../i18n/keys';

/** The map's menu is the floating menu standing on the map: its edge and no shadow, at least this wide. */
const MENU_LEAST_WIDTH = 160;
const MENU_HELP = { page: 'select' satisfies HelpPageId, anchor: 'select-menu' };

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 8px', marginBottom: 4, borderBottom: `1px solid ${LINE}` }}>
      <Thumb {...(item?.icon ? { src: iconUrl(item.icon) } : {})} {...(item?.color ? { color: item.color } : {})} />
      <span data-testid="context-menu-name" style={{ ...roleFont('head'), color: PLATE_INK, maxWidth: 220, lineHeight: 1.15, overflowWrap: 'break-word' }}>{name}</span>
    </div>
  );
}

/** The menu itself: the floating menu at `anchor`, a point in visual px, drawn at `zoom`, with the
 *  rows the target offers; `header` stands over them and `touch` raises each to a fingertip. Inside
 *  `AnimatePresence` it plays the card's exit before it goes. A Help figure hands no anchor and
 *  pictures it in its flow. */
export function ContextMenuFace({ rows, onPick, anchor, zoom = 1, onDismiss, header, touch = false, backId }: {
  anchor?: { x: number; y: number };
  /** The back-stack entry of the state the menu shows, whose place it takes (`useSurfaceScope`). */
  backId?: string;
  zoom?: number;
  onDismiss?: () => void;
  rows: readonly ContextMenuRow[];
  onPick: (id: string) => void;
  header?: ReactNode;
  touch?: boolean;
}) {
  const [present, safeToRemove] = usePresence();
  const current = rows.find((row) => row.current)?.id;
  return (
    <FloatMenu
      row={null}
      open={present}
      onOpen={() => {}}
      onClose={onDismiss ?? (() => {})}
      onPick={onPick}
      items={rows.map((row) => ({
        id: row.id, label: row.label, icon: row.icon, danger: row.danger, disabled: row.inactive, separated: row.separated,
      }))}
      {...(current ? { activeId: current } : {})}
      header={header}
      touch={touch}
      point={{ ...(anchor ?? { x: 0, y: 0 }), zoom, overlap: touch, minWidth: MENU_LEAST_WIDTH, onMap: true }}
      helpTarget={MENU_HELP}
      layer={z.contextMenu}
      {...(backId ? { backId } : {})}
      {...(safeToRemove ? { onExitComplete: safeToRemove } : {})}
    />
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
  const planetSession = useEditorStore((s) => s.planetSession);
  const canPaste = useEditorStore(pasteOffered);
  const locale = useLocale();

  const close = () => useEditorStore.getState().setContextMenu(null);
  /** One copy with its top-left on the cell the menu was opened at (EDIT-56). */
  const pasteHere = () => {
    const cell = menu ? cellAtScreen(menu.x, menu.y) : null;
    if (cell) pressCommand('selection.paste', { x: cell.x, y: cell.y });
    close();
  };

  // Build the menu content (or null) so AnimatePresence can play a close-exit.
  let content: ReactElement | null = null;
  const target = menu && executor ? menuTarget(menu.target, { gridState, planetSession }) : null;
  if (menu && target) {
    // menu.x/y are visual px (pointer event); the css coords live under the zoom, so divide it out.
    const anchor = { x: menu.x, y: menu.y };
    if (menu.target.kind === 'terrain') {
      const { x, y } = menu.target;
      const handleTerrainPick = (id: string) => {
        if (id === 'paste') { pasteHere(); return; }
        pressCommand('terrain.peel', { x, y });
        close();
      };
      content = (
        <ChromeLifted key="menu" control={TOUCH_TARGET} touch={touch}>
          {({ zoom: chrome }) => (
            <ContextMenuFace
              rows={terrainMenuRows(t, !target.peelable, canPaste, touch)}
              onPick={handleTerrainPick}
              touch={touch}
              anchor={anchor} zoom={chrome} onDismiss={close} backId={MAP_MENU_ENTRY}
            />
          )}
        </ChromeLifted>
      );
    } else if (target.object) {
      const obj = target.object;
      const item = getCatalogItem(obj.catalogId);
      const handleRotate = (angle: Rotation) => {
        pressCommand('selection.face', { angle: String(angle), object: obj.id });
        // A refused angle leaves the menu open on the object as it was.
        if (useEditorStore.getState().gridState?.objects.get(obj.id)?.rotation === angle) close();
      };
      const name = item ? localizedName(item.name, locale) : obj.catalogId;
      content = (
        <ChromeLifted key="menu" control={TOUCH_TARGET} touch={touch}>{({ zoom: chrome }) => (
        <ContextMenuFace
          rows={objectMenuRows(t, obj.rotation, target.rotatable, touch ? target : undefined, canPaste)}
          onPick={(id) => {
            // Delete and the finger's turn run the menu's own verbs: each one's key command has
            // another body (whatever stands in front for Delete, the selection's or the armed ghost's turn).
            if (id === 'delete') { deleteMenuObject(obj.id); close(); return; }
            if (id === 'paste') { pasteHere(); return; }
            // The finger's turn is the selection card's quarter turn, and the menu stays for the next one.
            if (id === 'rotate') { turnObjectQuarter(obj.id); return; }
            if (id === 'pick') { pressCommand('selection.pick', { object: obj.id }); close(); return; }
            if (id === 'move') { latchMove(obj.id); close(); return; }
            if (id === 'multi_select') { latchMultiSelect(obj.id); close(); return; }
            handleRotate(Number(id.slice('rotate_'.length)) as Rotation);
          }}
          anchor={anchor} zoom={chrome} onDismiss={close} backId={MAP_MENU_ENTRY}
          touch={touch}
          {...(touch ? { header: <MenuHeader item={item} name={name} /> } : {})}
        />
        )}</ChromeLifted>
      );
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
