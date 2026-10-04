/**
 * Everything the editor offers as a single tap: open a file dialog, pick a build surface, pick a
 * placement category, generate, move.
 *
 * A shell decides where these appear and what they look like. The keyboard registry reaches the
 * same actions, so a key and a tap run one code path.
 */
import { placedCategories } from '../config/catalog/categories';
import { SUPPORTS_JSON_FILES } from '../core/runtime/edition';

export interface EditorAction {
  id: string;
  action: 'file' | 'build' | 'placement' | 'generate' | 'move';
  /** Content type for `build`, catalog category for `placement`, dialog for `file`. */
  payload?: string;
  labelKey: string;
  icon: string;
  /** False where the offline edition does not offer the action (`core/runtime/edition.ts:inEdition`). */
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
  // Three build surfaces. Road is the promoted tile/path brush (contentType 'tile').
  { id: 'mountain', action: 'build', payload: 'mountain', labelKey: 'menu.build_mountain', icon: 'mountain' },
  { id: 'river',    action: 'build', payload: 'water',    labelKey: 'menu.build_river',    icon: 'river' },
  { id: 'road',     action: 'build', payload: 'tile',     labelKey: 'menu.build_road',     icon: 'road' },
  // Placement, generate and move.
  ...placedCategories('menuRank').map(({ id, placement: p }): EditorAction => (
    { id: p.actionId, action: 'placement', payload: id, labelKey: p.placeKey, icon: p.icon })),
  { id: 'generate', action: 'generate',                       labelKey: 'menu.generate',       icon: 'generate' },
  { id: 'move',     action: 'move',                           labelKey: 'menu.move',           icon: 'move' },
];

export const ACTION_BY_ID: ReadonlyMap<string, EditorAction> = new Map(ACTIONS.map((a) => [a.id, a]));
