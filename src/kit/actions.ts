/**
 * Everything the editor offers as a single tap: open a file dialog, pick a build surface, pick a
 * placement category, generate, move.
 *
 * A shell decides where these appear and what they look like. The keyboard registry reaches the
 * same actions, so a key and a tap run one code path.
 */
export interface EditorAction {
  id: string;
  action: 'file' | 'build' | 'placement' | 'generate' | 'move';
  /** Content type for `build`, catalog category for `placement`, dialog for `file`. */
  payload?: string;
  labelKey: string;
  icon: string;
}

/* File row — 4 actions. */
export const FILE_ACTIONS: readonly EditorAction[] = [
  { id: 'new',    action: 'file', payload: 'new',    labelKey: 'menu.new',    icon: 'new' },
  { id: 'image',  action: 'file', payload: 'image',  labelKey: 'menu.image',  icon: 'export-image' },
  { id: 'export', action: 'file', payload: 'export', labelKey: 'menu.export', icon: 'export' },
  { id: 'import', action: 'file', payload: 'import', labelKey: 'menu.import', icon: 'import' },
];

/* Three build surfaces. Road (绘制道路) is the promoted tile/path brush (contentType 'tile'). */
export const BUILD_ACTIONS: readonly EditorAction[] = [
  { id: 'mountain', action: 'build', payload: 'mountain', labelKey: 'menu.build_mountain', icon: 'mountain' },
  { id: 'river',    action: 'build', payload: 'water',    labelKey: 'menu.build_river',    icon: 'river' },
  { id: 'road',     action: 'build', payload: 'tile',     labelKey: 'menu.build_road',     icon: 'road' },
];

/* Placement + generate + move — 8 actions. */
export const GRID_ACTIONS: readonly EditorAction[] = [
  { id: 'building', action: 'placement', payload: 'building', labelKey: 'menu.place_building', icon: 'building' },
  { id: 'facility', action: 'placement', payload: 'facility', labelKey: 'menu.place_facility', icon: 'facility' },
  { id: 'tree',     action: 'placement', payload: 'tree',     labelKey: 'menu.place_tree',     icon: 'tree' },
  { id: 'flower',   action: 'placement', payload: 'flora',    labelKey: 'menu.place_flower',   icon: 'flower' },
  { id: 'bridge',   action: 'placement', payload: 'bridge',   labelKey: 'menu.place_bridge',   icon: 'bridge' },
  { id: 'ramp',     action: 'placement', payload: 'ramp',     labelKey: 'menu.place_ramp',     icon: 'ramp' },
  { id: 'generate', action: 'generate',                       labelKey: 'menu.generate',       icon: 'generate' },
  { id: 'move',     action: 'move',                           labelKey: 'menu.move',           icon: 'move' },
];

export const ACTIONS: readonly EditorAction[] = [...FILE_ACTIONS, ...BUILD_ACTIONS, ...GRID_ACTIONS];

export const ACTION_BY_ID: ReadonlyMap<string, EditorAction> = new Map(ACTIONS.map((a) => [a.id, a]));
