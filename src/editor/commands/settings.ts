/**
 * The commands behind the settings and switches no key runs: the Settings window's choices, the
 * regional load switch, a planet session's review switch, the assistant panel's place, the view's
 * turn buttons, immersive mode, the welcome tips and the Keyboard window's style and reset. Each
 * calls the setter or verb its control calls. A `destroy` command stands here so its control and
 * any other caller run one body; which callers may run it is each caller's policy.
 */
import { isChunkLoadEnforced } from '../../core/model/load';
import type { I18nKey } from '../../i18n/keys';
import { SUPPORTS_ASSISTANT } from '../../platform/build/edition';
import { fullscreenAvailable, isFullscreen, setImmersive } from '../../platform/device/fullscreen';
import { DOCK_SIDES, QUALITIES_3D, type DockSide, type Quality3d } from '../../platform/storage/prefs';
import { mapHeld } from '../../state/frame-pose';
import { PRESETS } from '../../state/keymap/registry';
import { detectPreset } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { resetLocalData } from '../session/local-reset';
import { startTour } from '../session/tour';
import { choice, toggle } from './app';
import { type Command, refuse, NO_MAP } from './types';

const store = () => useEditorStore.getState();

/** `command`, refused with the reason `barred` gives for its arguments, before anything is written. */
function unless(command: Command, barred: (args: Parameters<Command['invoke']>[0]) => string | null): Command {
  return {
    ...command,
    invoke(args, ctx) {
      const reason = barred(args);
      return reason === null ? command.invoke(args, ctx) : refuse(reason);
    },
  };
}

const NO_ASSISTANT = 'This edition has no assistant.';
const noAssistant = (): string | null => (SUPPORTS_ASSISTANT ? null : NO_ASSISTANT);

const TURNS = { left: -1, right: 1 } as const;
const TURN_DIRECTIONS = Object.keys(TURNS) as (keyof typeof TURNS)[];

const PRESET_IDS: readonly string[] = PRESETS.map((preset) => preset.id);
const PRESET_LABELS: Readonly<Partial<Record<string, I18nKey>>> = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.labelKey]));

export const SETTINGS_COMMANDS: readonly Command[] = [
  choice<Quality3d>(
    { id: 'settings.quality_3d', labelKey: 'modal.settings_quality3d', description: 'The graphics quality of the 3D view: auto follows the device, full and lite pin it.' },
    QUALITIES_3D, () => store().quality3d, (value) => store().setQuality3d(value),
    { auto: 'modal.settings_quality3d_auto', full: 'modal.settings_quality3d_full', lite: 'modal.settings_quality3d_lite' },
  ),
  toggle(
    { id: 'settings.system_cursors', labelKey: 'modal.settings_cursor', description: 'Whether the pointer is drawn with the system\'s cursors instead of the app\'s own.' },
    () => store().systemCursors, (on) => store().setSystemCursors(on),
  ),
  unless(
    {
      ...toggle(
        { id: 'map.load_enforced', labelKey: 'load.enforce', description: 'Whether the regional load limit is enforced on the open map; off, an edit may take a region past its limit.' },
        () => { const { gridState } = store(); return !!gridState && isChunkLoadEnforced(gridState); },
        (on) => store().setLoadEnforced(on),
      ),
      target: 'map',
    },
    () => (store().gridState ? null : NO_MAP),
  ),
  unless(
    toggle(
      { id: 'planet.review_shown', labelKey: 'planet.review_toggle', description: 'Whether a planet being edited draws the cells still to check on the map.' },
      () => store().planetReviewShown, (on) => store().setPlanetReviewShown(on),
    ),
    () => (store().planetSession?.review ? null : 'No planet with cells to check is being edited.'),
  ),
  unless(
    toggle(
      { id: 'app.assistant', labelKey: 'mode.assistant', description: 'Whether the assistant\'s panel is open.' },
      () => store().assistantOpen, (on) => store().setAssistantOpen(on),
    ),
    // A panel left open as a hand repair began still closes there; none opens while the map is held.
    ({ on }) => noAssistant() ?? (on === true && mapHeld(store()) ? 'The assistant opens only over the whole map editor; finish the planet or the repair first.' : null),
  ),
  unless(
    toggle(
      { id: 'assistant.pinned', labelKey: 'agent.pin_dock', description: 'Whether the assistant\'s panel docks to an edge of the window; a window too narrow keeps it free until there is room.' },
      () => store().assistantPinned, (on) => store().setAssistantPinned(on),
    ),
    noAssistant,
  ),
  unless(
    choice<DockSide>(
      { id: 'assistant.dock_side', labelKey: 'agent.pin_dock', description: 'Which side of the window the assistant\'s panel docks at.' },
      DOCK_SIDES, () => store().assistantDockSide, (value) => store().setAssistantDockSide(value),
      { left: 'agent.dock_switch_left', right: 'agent.dock_switch_right' },
    ),
    noAssistant,
  ),
  {
    id: 'camera.turn', effect: 'change', target: 'app', labelKey: 'a11y.rotate',
    description: 'Turns the map view one step, as the view\'s turn buttons do.',
    args: [{ name: 'direction', kind: 'enum', values: TURN_DIRECTIONS, labels: { left: 'a11y.rotate_left', right: 'a11y.rotate_right' }, description: 'Which way the view turns.' }],
    invoke({ direction }) {
      return host.camera.turnStep(TURNS[direction as keyof typeof TURNS]) ? `The view turned one step ${String(direction)}.` : refuse('No view is showing the map.');
    },
  },
  {
    id: 'view.fullscreen', effect: 'change', target: 'app', labelKey: 'modal.settings_immersive',
    description: 'Immersive mode: the page fills the screen. The browser grants it only to a press of the user\'s own, so a caller without one is refused by the browser and the page stays as it is.',
    args: [{ name: 'on', kind: 'boolean', optional: true, description: 'The state to set; left out, the command switches it.' }],
    current: isFullscreen,
    // No await before `setImmersive`: the browser's request needs the press's user activation.
    invoke({ on }) {
      if (!fullscreenAvailable()) return refuse('This browser or edition has no fullscreen.');
      const wanted = on === undefined ? !isFullscreen() : on === true;
      return setImmersive(wanted).then(() => (isFullscreen() === wanted
        ? `view.fullscreen is now ${wanted ? 'on' : 'off'}.` : refuse('The browser did not change fullscreen; it needs a press of the user\'s own.')));
    },
  },
  {
    id: 'tour.start', effect: 'change', target: 'app', labelKey: 'modal.settings_tour',
    description: 'Shows the welcome tips from their first card, over the app.',
    args: [],
    invoke: () => (startTour() ? 'The welcome tips are open on their first card.' : refuse('The welcome tips cannot open while a planet is being edited.')),
  },
  {
    id: 'keymap.preset', effect: 'change', target: 'app', labelKey: 'kbd.preset',
    description: 'The keyboard shortcut style. Setting one replaces every key the user assigned; custom is read when the keymap matches no style.',
    args: [{ name: 'value', kind: 'enum', values: PRESET_IDS, labels: PRESET_LABELS, description: 'The style to apply.' }],
    current: () => detectPreset(useKeybinds.getState().overrides),
    invoke({ value }) {
      const preset = PRESETS.find((entry) => entry.id === value);
      if (!preset) return refuse('Unknown shortcut style.');
      useKeybinds.getState().applyBinds(preset.binds);
      return `keymap.preset is now ${preset.id}.`;
    },
  },
  {
    id: 'keymap.reset', effect: 'destroy', target: 'app', labelKey: 'kbd.reset_all',
    description: 'Returns every key to the one the app ships, dropping the keys the user assigned.',
    args: [],
    invoke() {
      useKeybinds.getState().resetAll();
      return 'Every key is back to the one the app ships.';
    },
  },
  {
    id: 'app.reset_local_data', effect: 'destroy', target: 'app', labelKey: 'modal.settings_reset_btn',
    description: 'Erases everything this browser keeps for the app (the saved map, blueprints, settings, keys) and reloads the page.',
    args: [],
    async invoke() {
      await resetLocalData();
      return 'Local data is erased and the page reloads.';
    },
  },
];
