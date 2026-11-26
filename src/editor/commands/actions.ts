/**
 * Everything the editor offers as a single tap: open a file dialog, pick a build surface, pick a
 * placement category, generate, move; `runTileAction`, which does it; and `setMode`, the one body
 * under a mode's tile and its key.
 *
 * A shell decides where these appear and what they look like. The keyboard registry reaches the
 * same actions, so a key and a tap run one code path.
 */
import { placedCategories } from '../../config/catalog/categories';
import { inEdition, SUPPORTS_JSON_FILES } from '../../platform/build/edition';
import type { I18nKey } from '../../i18n/keys';
import { contentTypeOf, designModeArming, isAnnotating, isContentMode, modeOpenIn, type BuildMode } from '../../state/editing/edit-mode';
import type { DesignMode } from '../../state/editing/vocabulary';
import { useEditorStore } from '../../state/store';
import { showNotesForEditing } from '../editing/annotation-edit';

interface EditorAction {
  id: string;
  action: 'file' | 'build' | 'placement' | 'generate' | 'move';
  /** Content type for `build`, catalog category for `placement`, dialog for `file`. */
  payload?: string;
  labelKey: I18nKey;
  icon: string;
  /** False where the offline edition does not offer the action (`platform/build/edition.ts:inEdition`). */
  lite?: false;
}

const PLANET_FILES: Pick<EditorAction, 'lite'> = SUPPORTS_JSON_FILES ? {} : { lite: false };

export const ACTIONS: readonly EditorAction[] = [
  // File row.
  { id: 'new',    action: 'file', payload: 'new',    labelKey: 'modal.new_title', icon: 'new' },
  { id: 'image',  action: 'file', payload: 'image',  labelKey: 'menu.image',  icon: 'export-image' },
  // Planet files, offered where the edition reads and writes them (the flag the export command reads).
  { id: 'export', action: 'file', payload: 'export', labelKey: 'menu.export', icon: 'export', ...PLANET_FILES },
  { id: 'import', action: 'file', payload: 'import', labelKey: 'menu.import', icon: 'import', ...PLANET_FILES },
  // Three build surfaces; the payload is the surface's build mode. `river` is the water surface's
  // action id, which saved keymaps name (`surface.river`).
  { id: 'mountain', action: 'build', payload: 'mountain', labelKey: 'menu.build_mountain', icon: 'mountain' },
  { id: 'river',    action: 'build', payload: 'water',    labelKey: 'menu.build_river',    icon: 'river' },
  { id: 'road',     action: 'build', payload: 'road',     labelKey: 'menu.build_road',     icon: 'road' },
  // Placement, generate and move.
  ...placedCategories('menuRank').map(({ id, placement: p }): EditorAction => (
    { id: p.actionId, action: 'placement', payload: id, labelKey: p.placeKey, icon: p.icon })),
  { id: 'generate', action: 'generate',                       labelKey: 'menu.generate',       icon: 'generate' },
  { id: 'move',     action: 'move',                           labelKey: 'menu.move',           icon: 'move' },
];

export const ACTION_BY_ID: ReadonlyMap<string, EditorAction> = new Map(ACTIONS.map((a) => [a.id, a]));

/**
 * A build-tool key's design mode on the surface in force: the mode's own terrain surface, or the
 * store's `contentType` surface where none is up. The notes bar has its own cells, so a terrain tool
 * key pressed there leaves the notes alone; a planet session has no road surface, so a tool key
 * there opens the mountain one.
 */
export function openBuildSurface(design: DesignMode): void {
  const s = useEditorStore.getState();
  if (isAnnotating(s)) return;
  const wanted = isContentMode(s.editMode.mode) ? s.editMode.mode : contentTypeOf(s);
  if (s.repairSession?.phase === 'hand') return;
  const surface = modeOpenIn(s.planetSession, wanted) ? wanted : 'mountain';
  s.setEditMode({ mode: surface, arm: designModeArming(design) });
}

/**
 * Opens `mode`, or rests for null: the one body of a mode's tile and its key. A tile resumes the
 * mode as it was left. A key opens it `afresh`: a build surface takes the free brush whatever it
 * held, the object shelf puts an armed card down, and rest ends a region selection itself, at rest
 * too, where a tile's rest ends one only as the mode changes and sets the assistant's region
 * history aside for its brush to pick up again. Notes open shown, where they can open at all.
 */
export function setMode(mode: BuildMode, afresh = false): void {
  const s = useEditorStore.getState();
  if (mode === null) {
    // Both arm the pointer, and a region left on would hand every press to the brush that paints a scope.
    if (afresh) s.setSelectingRegion(false);
    s.setEditMode({ mode: null });
  } else if (mode === 'annotate') {
    showNotesForEditing();
  } else if (afresh && isContentMode(mode)) {
    s.setEditMode({ mode, arm: { kind: 'brush' } });
  } else if (afresh && mode === 'object' && s.editMode.arming.kind === 'item') {
    s.setEditMode({ mode, arm: { kind: 'none' } });
  } else {
    s.setEditMode({ mode });
  }
}

/** The mode each tap action opens; a build action's payload is its surface's mode. */
const TILE_MODE: Record<Exclude<EditorAction['action'], 'file'>, (action: EditorAction) => BuildMode> = {
  move: () => null,
  build: (action) => action.payload as BuildMode,
  placement: () => 'object',
  generate: () => 'generate',
};

/** Runs a tap action: a file window the edition offers, or a mode opened afresh as its key opens it
 *  (`setMode`), the move tile being rest. */
export function runTileAction(action: EditorAction): void {
  const s = useEditorStore.getState();
  if (action.action === 'file') {
    if (!inEdition(action)) return;
    if (action.payload === 'new') s.setModal('newProject', true);
    // The save-and-share window carries both exports as sections, and opens at the one named.
    else if (action.payload === 'image') s.openShare('friend');
    else if (action.payload === 'export') s.openShare('keep');
    else if (action.payload === 'import') s.setModal('import', true);
    return;
  }
  setMode(TILE_MODE[action.action](action), true);
}
