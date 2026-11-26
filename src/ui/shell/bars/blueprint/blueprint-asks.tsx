/**
 * What the strip and the explorer offer on a card or folder itself, in the app's anchored grammar: a
 * name under the text check for a new folder or a rename (`../NameCard.tsx`, shared with Notes), the
 * menu a folder opens on a right press or a hold, the menu a mouse's right press on a card or the
 * selection opens and a touch card's menu button opens, and the question a folder's delete asks. Each
 * hangs from what was pressed and leaves it as it was. One set stands per shelf (`useLibraryAsks`),
 * which the strip's and the explorer's cards and folders reach by context.
 */
import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { SUPPORTS_JSON_FILES } from '../../../../platform/build/edition';
import { blueprintFolderVerbs, blueprintVerbs, folderNameProblem, type BlueprintVerb, type FolderVerb } from '../../../../editor/editing/blueprint';
import type { I18nKey } from '../../../../i18n/keys';
import { BLUEPRINT_NAME_MAX } from '../../../../io/blueprint/facts';
import { ControlConfirm } from '../../../primitives/ControlConfirm';
import { useExportNotice } from '../../../chrome/modals/export/review/ExportNotice';
import { FloatMenu, type FloatMenuItem } from '../../../primitives/FloatMenu';
import { ExportFileIcon, MoreIcon, NewFolderIcon } from '../../../primitives/line-glyphs';
import { useNameReveal } from '../../../primitives/use-name-reveal';
import { NameCard, type NameCardProps } from '../NameCard';
import { RoundPlateButton } from '../RoundPlateButton';
import { TOUCH_TARGET } from '../../../design/scale';
import { zCards } from '../../../design/styles';
import { ICON_SHARE } from '../objects/ShelfSearchPill';
import { useHoldMenu } from '../use-list-carry';
import type { ExportScope } from '../../../../state/blueprint-library-view';
import { useRunCommandBehindNotice } from '../../use-shell-commands';
import type { BlueprintShelfModel } from './use-blueprint-shelf';
import { tourTargetAttr } from '../../../chrome/tour/steps';

/** The shared name card with the blueprint library's help page, name length and check wording. */
function BlueprintNameCard({ refusedKey, ...card }: Omit<NameCardProps, 'helpTarget' | 'maxLength' | 'refusedText' | 'unavailableText'> & { refusedKey: I18nKey }) {
  const t = useT();
  return (
    <NameCard {...card} helpTarget={{ page: 'blueprint-library' }} maxLength={BLUEPRINT_NAME_MAX}
      refusedText={t(refusedKey)} unavailableText={t('blueprint.check_unavailable')} />
  );
}

/** A control that makes a folder: its anchor, whether it asks now, and the name card it asks with. */
function useNewFolderAsk(model: BlueprintShelfModel): {
  ref: RefObject<HTMLButtonElement>; asking: boolean; toggle: () => void; card: ReactNode;
} {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  return {
    ref, asking, toggle: () => setAsking((was) => !was),
    card: (
      <AnimatePresence>
        {asking ? (
          <BlueprintNameCard key="folder" anchor={ref} title={t('blueprint.new_folder')} confirmLabel={t('blueprint.folder_create')}
            label={t('blueprint.field_folder')} field="blueprint-folder" known="" refusedKey="blueprint.folder_refused"
            onCancel={() => setAsking(false)} onConfirm={(name) => { model.addFolder(name); setAsking(false); }} />
        ) : null}
      </AnimatePresence>
    ),
  };
}

/** New folder as a round button beside search, where the object shelf has its brush button, in the
 *  brush button's plate: it asks for the name under itself and opens the folder it made. */
export function NewFolderButton({ model, size, piece, style }: {
  model: BlueprintShelfModel;
  /** The button's side in the row's px: the search's height. */
  size: number;
  piece?: Record<string, string>;
  style?: CSSProperties;
}) {
  const t = useT();
  const ask = useNewFolderAsk(model);
  const label = t('blueprint.new_folder');
  const name = useNameReveal(label);
  return (
    <>
      <RoundPlateButton
        ref={ask.ref}
        {...name.bind}
        {...piece}
        size={size}
        aria-label={label}
        aria-expanded={ask.asking}
        data-testid="shell-blueprint-new-folder"
        onClick={ask.toggle}
        style={{ alignItems: 'center', justifyContent: 'center', ...style }}
      >
        <NewFolderIcon size={Math.round(size * ICON_SHARE)} />
        {name.bubble}
      </RoundPlateButton>
      {ask.card}
    </>
  );
}

/** What a press on the head's Export exports, as its name says it. */
function exportName(t: ReturnType<typeof useT>, scope: ExportScope): string {
  const n = scope.ids.length;
  // Nothing to export: the button stands dimmed under its plain name.
  if (n === 0) return t('blueprint.export');
  switch (scope.kind) {
    case 'named': return t('blueprint.export_named', { name: scope.name });
    case 'selected': return t('blueprint.export_selected', { n });
    case 'found': return t('blueprint.export_found', { n });
    case 'folder': return t('blueprint.export_folder', { n, folder: scope.folder });
    case 'all': return t('blueprint.export_all', { n });
  }
}

/** A press of Export for the blueprints `which` names, or a folder's: `blueprints.export` behind
 *  `notice`, the notice the pressed surface shows. */
function useExportPress(notice: () => Promise<boolean>): (which: readonly string[] | { folder: string }) => void {
  const run = useRunCommandBehindNotice(notice);
  return (which) => run('blueprints.export', 'folder' in which ? { folder: which.folder } : { ids: which.join(',') });
}

/** The explorer head's one Export, a round button beside New folder, exporting what the explorer
 *  shows (`BlueprintShelfModel.exportScope`), its name saying which, once the export notice every
 *  export opens is accepted; absent where the edition writes no files. */
export function ExportButton({ model, size, piece }: { model: BlueprintShelfModel; size: number; piece?: Record<string, string> }) {
  const t = useT();
  const scope = model.exportScope;
  const label = exportName(t, scope.kind === 'folder' ? { ...scope, folder: model.folderName(scope.folder) } : scope);
  const name = useNameReveal(label, 'below');
  // A consent given for one scope is retired when the scope changes; the map file's line is the map's own.
  const notice = useExportNotice(SUPPORTS_JSON_FILES, `${scope.kind}:${scope.ids.join(',')}`, null);
  const exportOf = useExportPress(notice.request);
  if (!SUPPORTS_JSON_FILES) return null;
  const press = () => {
    if (scope.ids.length > 0) exportOf(scope.kind === 'folder' ? { folder: scope.folder } : scope.ids);
  };
  return (
    <>
      <RoundPlateButton {...name.bind} {...piece} {...tourTargetAttr('blueprint-export')} size={size} aria-label={label} data-testid="shell-blueprint-export"
        unavailable={scope.ids.length === 0} onClick={press} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ExportFileIcon size={Math.round(size * ICON_SHARE)} />
        {name.bubble}
      </RoundPlateButton>
      {notice.notice}
    </>
  );
}

/** What a card or folder reaches to ask: rename blueprint `id` under `anchor`, or open a folder's or
 *  the selection's own menu there. */
interface LibraryAsks {
  rename: (id: string, anchor: HTMLElement) => void;
  folderMenu: (folder: string, anchor: HTMLElement) => void;
  /** The menu of the blueprints `ids`, a selection or one card: rename one, move, or delete as a drop
   *  on the delete target does. */
  itemsMenu: (ids: readonly string[], anchor: HTMLElement) => void;
  /** Whether the menu of blueprint `id` alone, or the move list it led to, stands open. */
  itemsOpenFor: (id: string) => boolean;
  /** Puts away whatever stands asked. */
  dismiss: () => void;
}

const NO_ASKS: LibraryAsks = { rename: () => {}, folderMenu: () => {}, itemsMenu: () => {}, itemsOpenFor: () => false, dismiss: () => {} };
const AsksContext = createContext<LibraryAsks>(NO_ASKS);
export const LibraryAsksProvider = AsksContext.Provider;
export const useAsks = (): LibraryAsks => useContext(AsksContext);

type Asking =
  | { kind: 'rename'; id: string }
  | { kind: 'folder'; folder: string; menu: boolean; card: 'rename' | 'delete' | null }
  | { kind: 'items'; ids: readonly string[]; moving: boolean };

const FOLDER_VERB_LABELS = { rename: 'blueprint.rename', export: 'blueprint.export', delete: 'blueprint.delete' } as const satisfies Record<FolderVerb, I18nKey>;

/** A folder's menu: what that folder allows (`blueprintFolderVerbs`). */
export function folderMenuItems(t: ReturnType<typeof useT>, folder: string): FloatMenuItem[] {
  return blueprintFolderVerbs(folder).map((verb) => ({ id: verb, label: t(FOLDER_VERB_LABELS[verb]) }));
}

const BLUEPRINT_VERB_LABELS = {
  rename: 'blueprint.rename', move: 'blueprint.move', export: 'blueprint.export', delete: 'blueprint.delete',
} as const satisfies Record<BlueprintVerb, I18nKey>;

/** The menu of `count` blueprints, one or a selection: what they offer (`blueprintVerbs`). */
export function blueprintMenuItems(t: ReturnType<typeof useT>, count: number): FloatMenuItem[] {
  return blueprintVerbs(count).map((verb) => ({ id: verb, label: t(BLUEPRINT_VERB_LABELS[verb]) }));
}

/** The move list's row for no folder; a folder's name is never blank. */
const NO_FOLDER = '';

/** The shelf's one set of asks: the cards and menus they open, hanging from the element pressed. */
export function useLibraryAsks(model: BlueprintShelfModel): { asks: LibraryAsks; node: ReactNode } {
  const t = useT();
  const anchor = useRef<HTMLElement>(null) as RefObject<HTMLElement> & { current: HTMLElement | null };
  const [asking, setAsking] = useState<Asking | null>(null);
  const close = () => setAsking(null);
  // A menu's Export asks the notice every export opens, for what it was picked on.
  const notice = useExportNotice(SUPPORTS_JSON_FILES, 'menu', null);
  const exportOf = useExportPress(notice.request);
  const exportAfterNotice = (which: readonly string[] | { folder: string }) => {
    close();
    exportOf(which);
  };
  const at = (el: HTMLElement, next: Asking) => { anchor.current = el; setAsking(next); };
  const asks: LibraryAsks = {
    rename: (id, el) => at(el, { kind: 'rename', id }),
    folderMenu: (folder, el) => at(el, { kind: 'folder', folder, menu: true, card: null }),
    itemsMenu: (ids, el) => { if (ids.length > 0) at(el, { kind: 'items', ids, moving: false }); },
    itemsOpenFor: (id) => asking?.kind === 'items' && asking.ids.length === 1 && asking.ids[0] === id,
    dismiss: close,
  };
  const record = asking?.kind === 'rename' ? model.records.find((r) => r.id === asking.id) : undefined;
  const folder = asking?.kind === 'folder' ? asking.folder : null;
  const folderName = folder === null ? '' : model.folderName(folder);
  const n = folder === null ? 0 : model.countOf(folder);
  const problem = (name: string): string | null => {
    const why = folderNameProblem(name, folder, model.folders);
    return why === null ? null : t(why === 'blank' ? 'blueprint.folder_blank' : 'blueprint.folder_taken');
  };
  const items = asking?.kind === 'items' ? asking.ids : [];
  // The folder every one of them is in, which the move list marks.
  const held = model.records.filter((r) => items.includes(r.id));
  const shared = held.length > 0 && held.every((r) => r.folder === held[0]!.folder) ? held[0]!.folder ?? NO_FOLDER : undefined;
  const node = (
    <>
      <FloatMenu
        row={null}
        trigger={{ ref: anchor, align: 'start', onMap: true }}
        open={asking?.kind === 'folder' && asking.menu}
        onOpen={() => {}}
        onClose={() => setAsking((was) => (was?.kind === 'folder' && was.menu ? null : was))}
        aria-label={folderName}
        items={folder === null ? [] : folderMenuItems(t, folder)}
        onPick={(id) => {
          if (folder === null) return;
          if (id === 'export') exportAfterNotice({ folder });
          else setAsking({ kind: 'folder', folder, menu: false, card: id as 'rename' | 'delete' });
        }}
      />
      <FloatMenu
        row={null}
        trigger={{ ref: anchor, align: 'start', onMap: true }}
        open={asking?.kind === 'items' && !asking.moving}
        onOpen={() => {}}
        onClose={() => setAsking((was) => (was?.kind === 'items' && !was.moving ? null : was))}
        aria-label={t('blueprint.count', { n: items.length })}
        items={blueprintMenuItems(t, items.length)}
        onPick={(id) => {
          if (id === 'rename') { setAsking({ kind: 'rename', id: items[0]! }); return; }
          if (id === 'move') { setAsking({ kind: 'items', ids: items, moving: true }); return; }
          if (id === 'export') { exportAfterNotice(items); return; }
          model.remove(items);
          close();
        }}
      />
      <FloatMenu
        row={null}
        trigger={{ ref: anchor, align: 'start', onMap: true }}
        open={asking?.kind === 'items' && asking.moving}
        onOpen={() => {}}
        onClose={() => setAsking((was) => (was?.kind === 'items' && was.moving ? null : was))}
        aria-label={t('blueprint.move')}
        {...(shared === undefined ? {} : { activeId: shared })}
        items={[{ id: NO_FOLDER, label: t('blueprint.no_folder') }, ...model.folders.map((f) => ({ id: f, label: model.folderName(f) }))]}
        onPick={(id) => { model.move(items, id === NO_FOLDER ? null : id); close(); }}
      />
      <AnimatePresence>
        {record ? (
          <BlueprintNameCard key={`rename-${record.id}`} anchor={anchor} title={t('blueprint.rename_title')} confirmLabel={t('blueprint.rename')}
            label={t('blueprint.field_name')} field="blueprint-name" known={record.name} refusedKey="blueprint.name_refused"
            onCancel={close} onConfirm={(name) => { model.rename(record.id, name); close(); }} />
        ) : null}
        {asking?.kind === 'folder' && asking.card === 'rename' ? (
          <BlueprintNameCard key={`folder-rename-${asking.folder}`} anchor={anchor} title={t('blueprint.folder_rename')} confirmLabel={t('blueprint.rename')}
            label={t('blueprint.field_folder')} field="blueprint-folder" known={folderName} refusedKey="blueprint.folder_refused" problem={problem}
            onCancel={close} onConfirm={(name) => { void model.renameFolder(asking.folder, name).then((free) => { if (free) close(); }); }} />
        ) : null}
        {asking?.kind === 'folder' && asking.card === 'delete' ? (
          <ControlConfirm key={`folder-delete-${asking.folder}`} anchor={anchor} prefer="above" helpTarget={{ page: 'blueprint-library', anchor: 'bplibrary-folders' }}
            title={n > 0 ? t('blueprint.delete_folder_title', { name: folderName, n }) : t('blueprint.delete_folder_empty_title', { name: folderName })}
            cancelLabel={t('delete.cancel')} confirmLabel={t('blueprint.delete')}
            onCancel={close} onConfirm={() => { model.removeFolder(asking.folder); close(); }} />
        ) : null}
      </AnimatePresence>
      {notice.notice}
    </>
  );
  return { asks, node };
}

/** The menu button's drawn side on a card, in css px; its hit area is a fingertip's whatever it draws. */
export const MENU_SIDE = TOUCH_TARGET * 0.75;

/** The menu button of the blueprint `id` (`BlueprintShelfModel.menuOn`) on its card's top left corner, a
 *  round plate button whose press is a fingertip's square inside the card, so a scrolling view never
 *  cuts it; `inline` stands it where its parent places it. It opens the card's menu hanging from itself,
 *  and a press while that stands open puts it away. */
export function MenuCorner({ id, size, inline = false }: { id: string; size: number; inline?: boolean }) {
  const t = useT();
  const asks = useAsks();
  const label = t('blueprint.more');
  const name = useNameReveal(label);
  const reach = Math.max(TOUCH_TARGET, size);
  const open = asks.itemsOpenFor(id);
  return (
    <RoundPlateButton {...name.bind} size={size} reach={reach} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-testid="blueprint-menu" onClick={(e) => { if (open) asks.dismiss(); else asks.itemsMenu([id], e.currentTarget); }}
      style={inline ? { margin: (size - reach) / 2 } : { position: 'absolute', left: 0, top: 0, zIndex: zCards.over }}>
      <MoreIcon size={Math.round(size * ICON_SHARE)} />
      {name.bubble}
    </RoundPlateButton>
  );
}

/** What a folder's tab or entry wears to open its own menu: a right press, or a finger held still on
 *  it; nothing on All or a folder whose menu would offer nothing. */
export function useFolderPress(): (folder: string | null) => Record<string, unknown> {
  const asks = useAsks();
  const holdMenu = useHoldMenu();
  return (folder) => (folder === null || blueprintFolderVerbs(folder).length === 0 ? {} : { ...holdMenu((el) => asks.folderMenu(folder, el)) });
}
