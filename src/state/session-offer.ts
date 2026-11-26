/**
 * What a session that holds the map offers (`frame-pose.ts:mapHeld`). A planet being edited and a
 * hand repair each offer a part of the editor; outside both, everything is offered. The command door
 * refuses what a session does not offer for every caller, and the frame shows a control only where
 * its command or window is offered, so the rule is stated here once.
 *
 * A command the keymap has a row for is closed unless the session lists it: its key answers
 * (`keys`), or only its control is pressed there (`controls`). A command no key runs is open unless
 * the session withholds it (`withheld`, `WITHHELD_FAMILIES`), since its own verb already follows the
 * session's modes and tools; what is withheld is what the session's frame shows no control for.
 */
import { surfaceTools } from './editing/edit-mode';
import type { FramePose } from './frame-pose';
import { META_BY_ID, SURFACE_TOOL_COMMANDS, type CommandId } from './keymap/registry';
import type { ModalId } from './slices/shell';

interface SessionOffer {
  /** The commands whose keys answer, which every caller runs. Every other binding still takes its
   *  key there, so no browser default fires in its place. */
  keys: ReadonlySet<string>;
  /** The commands with a key that only a control presses there: the key rests. */
  controls: ReadonlySet<string>;
  /** The commands no key runs that no caller runs there. */
  withheld: ReadonlySet<string>;
  /** The windows it opens. */
  windows: ReadonlySet<ModalId>;
}

/** The keys every session answers: history, the camera, the interface's size, deleting and backing
 *  out, the menu, Help and What's this. */
const SESSION_KEYS = [
  'history.undo', 'history.redo',
  'camera.zoom_in', 'camera.zoom_out', 'camera.fit', 'app.ui_zoom_in', 'app.ui_zoom_out',
  'selection.delete', 'selection.deselect',
  'app.menu', 'app.help', 'app.whats_this',
] as const satisfies readonly CommandId[];

/** What every session's controls press among the commands with a key: Select all and Flip on the
 *  touch multi-select bar, and the grid in Settings. */
const SESSION_CONTROLS = ['selection.all', 'selection.flip', 'overlay.grid'] as const satisfies readonly CommandId[];

/** What no session runs among the commands without a key: the welcome tips, the regional load
 *  switch, the planet editor's opening, which Change planet's controls press, and resuming the saved
 *  session, which would replace the map the session set aside. */
const SESSION_WITHHELD: readonly string[] = ['tour.start', 'map.load_enforced', 'planet.edit', 'session.restore'];

/** The surfaces no session has, by their commands' family, the part of the id before its dot:
 *  Blueprint with its library, the planets and Generate's batch. */
const WITHHELD_FAMILIES: ReadonlySet<string> = new Set(['blueprints', 'planets', 'generate']);

/** The windows every session opens: the menu's own, and the Keyboard window Settings and Help open. */
const SESSION_WINDOWS: readonly ModalId[] = ['settings', 'help', 'about', 'keyboard'];

const OFFERS: Readonly<Record<Exclude<FramePose, 'map'>, SessionOffer>> = {
  // The planet editor: its two ground surfaces with the tools their rows offer, the shapes, the brush
  // size, turning a landmark and the chunk bounds; no view switch, hide toggle or layer panel.
  planet: {
    keys: new Set<string>([
      ...SESSION_KEYS,
      'overlay.chunks',
      'surface.mountain', 'surface.river',
      ...surfaceTools('mountain', { planetSession: true, printArmed: false }).map((tool) => SURFACE_TOOL_COMMANDS[tool]),
      'tool.shape_cycle', 'tool.free', 'tool.line', 'tool.curve', 'tool.rect', 'tool.circle',
      'brush.bigger', 'brush.smaller',
      'selection.rotate_cw', 'selection.rotate_ccw',
    ] satisfies CommandId[]),
    controls: new Set<string>(SESSION_CONTROLS),
    withheld: new Set([
      ...SESSION_WITHHELD,
      'view.interface_hidden', 'view.layer_visible', 'view.layer_locked', 'view.annotations', 'view.annotations_locked',
    ]),
    windows: new Set(SESSION_WINDOWS),
  },
  // A hand repair: no mode and no tool; the rail keeps the view switch, the hide toggle and the
  // layer panel, and the touch multi-select bar its Rotate.
  repair: {
    keys: new Set<string>(SESSION_KEYS),
    controls: new Set<string>([
      ...SESSION_CONTROLS,
      'selection.rotate_cw',
      'view.toggle', 'overlay.numbers', 'overlay.chunks',
    ] satisfies CommandId[]),
    withheld: new Set(SESSION_WITHHELD),
    windows: new Set(SESSION_WINDOWS),
  },
};

/** Whether command `id` runs in `pose`, for a key, a control and a caller by id alike. */
export function sessionOffers(pose: FramePose, id: string): boolean {
  if (pose === 'map') return true;
  const offer = OFFERS[pose];
  if (META_BY_ID.has(id)) return offer.keys.has(id) || offer.controls.has(id);
  return !offer.withheld.has(id) && !WITHHELD_FAMILIES.has(id.slice(0, id.indexOf('.')));
}

/** Whether the key of command `id` answers in `pose`. */
export function sessionKeyAnswers(pose: FramePose, id: string): boolean {
  return pose === 'map' || OFFERS[pose].keys.has(id);
}

/** Whether `pose` opens window `id`. */
export function sessionOpens(pose: FramePose, id: ModalId): boolean {
  return pose === 'map' || OFFERS[pose].windows.has(id);
}
