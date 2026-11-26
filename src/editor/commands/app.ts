/**
 * The commands that take arguments: those no key runs, since a key can give none (`UNBOUND_COMMANDS`),
 * and what a key's command also takes from a caller that can give it (`KEY_FORMS`). Each calls the
 * setter or verb the interface calls and adds no state of its own.
 */
import { ELEVATION_MAX, PLACEMENT_GRID, TERRAIN_GRID, layerNumber } from '../../core/game/profile';
import { LOCALES, isLocale } from '../../core/model/locale';
import type { I18nKey } from '../../i18n/keys';
import type { JsonSections } from '../../io/export/json-sections';
import { FOOTER_FILL, FOOTER_TEMPLATE_MAX, FOOTER_TOKENS, unknownFooterTokens } from '../../io/export/footer-template';
import { openingExportOptions } from '../../io/export/options-store';
import { EXPORT_PRESETS, RESOLUTION_KEYS, type ExportOptions } from '../../io/export/types';
import { SECTIONS } from '../../io/save/sections';
import {
  GRID_MODES, MOTION_PREFS, UI_ZOOM_MAX, UI_ZOOM_MIN, VIEW_MODES, type GridMode, type MotionPref, type ViewMode,
} from '../../platform/storage/prefs';
import { framePose } from '../../state/frame-pose';
import { sessionOpens } from '../../state/session-offer';
import { MODAL_IDS, SHARE_SECTIONS, interfaceHidden, type ModalId, type ShareSection } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { MAX_SHOTS, MIN_SHOTS } from '../../state/shot-list';
import { prepareFileExport, prepareImageExport } from '../export/prepared';
import { exportShots, setExportShotCount } from '../export/shots';
import { applyExportPreset } from '../review/edition-review';
import { switchLocale } from '../session/locale';
import { SUPPORTS_PICTURE_IMPORT } from '../../platform/build/edition';
import { hasWebGL2 } from '../../platform/device/device-quality';
import type { RunCommandId } from '../../state/keymap/registry';
import { PASTE_AT_CELL } from './selection';
import { type Command, type CommandArg, type CommandArgs, type CommandResult, type CommandValue, type OptionalArg, refuse, NO_MAP } from './types';

const store = () => useEditorStore.getState();
const NOT_TAKEN = 'The app did not take the change in its present state.';

/** What a key's command adds for a caller that can give arguments. */
interface KeyForm {
  args: readonly OptionalArg[];
  current?(): CommandValue;
  /** Runs in the key body's place; `key` runs that body, for a call that gives no argument. */
  run(args: CommandArgs, key: () => void): CommandResult | Promise<CommandResult>;
}

type Naming = Pick<Command, 'id' | 'labelKey' | 'description'>;

const ON_ARG = { name: 'on', kind: 'boolean', description: 'The state to set.' } as const;

/** An on/off command over one getter and one setter; a setter that declines leaves the value, which is refused. */
export function toggle(naming: Naming, read: () => boolean, write: (on: boolean) => void): Command {
  return {
    ...naming, effect: 'change', target: 'app',
    args: [ON_ARG],
    current: read,
    invoke({ on }) {
      write(on === true);
      return read() === on ? `${naming.id} is now ${on ? 'on' : 'off'}.` : refuse(NOT_TAKEN);
    },
  };
}

/** A key's switch, which a caller may also set outright. */
function switchForm(id: RunCommandId, read: () => boolean, write: (on: boolean) => void): KeyForm {
  return {
    args: [{ ...ON_ARG, optional: true, description: 'The state to set; left out, the command switches it.' }],
    current: read,
    run({ on }, key) {
      if (on === undefined) key();
      else write(on === true);
      return `${id} is now ${read() ? 'on' : 'off'}.`;
    },
  };
}

/** A one-of command over one getter and one setter. */
export function choice<V extends string>(
  naming: Naming, values: readonly V[],
  read: () => V, write: (value: V) => void, labels?: Readonly<Partial<Record<V, I18nKey>>>,
): Command {
  return {
    ...naming, effect: 'change', target: 'app',
    args: [{ name: 'value', kind: 'enum', values, description: 'The choice to set.', ...(labels ? { labels } : {}) }],
    current: read,
    invoke({ value }) {
      write(value as V);
      return `${naming.id} is now ${String(value)}.`;
    },
  };
}

/** The layer argument: the number the interface shows, the ground being 1. */
const LAYER_ARG: CommandArg = {
  name: 'layer', kind: 'number', integer: true, min: layerNumber(0), max: layerNumber(ELEVATION_MAX),
  description: 'The layer number as the layer panel shows it; the ground is 1.',
};
const elevationOf = (layer: CommandValue | undefined): number => Number(layer) - layerNumber(0);
const layerList = (elevations: readonly number[]): string => [...elevations].sort((a, b) => a - b).map(layerNumber).join(', ');

/** Windows that stand only inside another window's flow, so none is opened on its own. */
const FLOW_WINDOWS: ReadonlySet<ModalId> = new Set<ModalId>(['landmarkRepair', 'planetImport']);
const OPENABLE_WINDOWS: readonly ModalId[] = MODAL_IDS.filter((id) => !FLOW_WINDOWS.has(id));
const WINDOW_LABELS: Readonly<Partial<Record<ModalId, I18nKey>>> = {
  help: 'modal.help_title', keyboard: 'modal.keyboard_title', settings: 'modal.settings_title', about: 'modal.about_title',
  newProject: 'modal.new_title', preview3d: 'view3d.preview_title', import: 'import.title', share: 'share.title',
  stylize: 'stylize.win_title', regionLoad: 'hud.region_load',
};

/** Opens the save-and-share window at `section`. A window already open is closed first and opened
 *  again a task later, since it reads its section only as it opens. */
async function showShare(section: ShareSection): Promise<void> {
  if (store().modals.share) {
    store().setModal('share', false);
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  store().openShare(section);
}

const CONFIRM = 'The export window is open for review and confirmation; nothing was downloaded.';

/** The picture's on/off choices, by argument name. */
const IMAGE_SWITCHES = {
  badge: 'showBadge', layer_preview: 'layerPreview', card_3d: 'card3d', grid: 'grid', footer: 'footer', annotations: 'annotations',
} as const satisfies Record<string, keyof ExportOptions>;
const IMAGE_SWITCH_NOTES: Record<keyof typeof IMAGE_SWITCHES, string> = {
  badge: 'Show the provenance badge.',
  layer_preview: 'Draw the per-layer preview column.',
  card_3d: 'Draw the 3D preview card.',
  grid: 'Draw the grid and coordinates.',
  footer: 'Draw the footer details.',
  annotations: 'Draw the planning annotations on the map.',
};
const imageSwitchNames = Object.keys(IMAGE_SWITCHES) as (keyof typeof IMAGE_SWITCHES)[];

const FILE_SWITCHES = [...SECTIONS.map(({ key }) => key), 'pretty'] as const;
const HISTORY_DEPTHS = ['all', 'recent'] as const satisfies readonly JsonSections['historyDepth'][];

const GRID_LABELS: Readonly<Partial<Record<GridMode, I18nKey>>> = {
  auto: 'modal.settings_grid_auto', [PLACEMENT_GRID]: 'modal.settings_grid_object', [TERRAIN_GRID]: 'modal.settings_grid_terrain', off: 'modal.settings_grid_off',
};

const given = (args: CommandArgs): boolean => Object.keys(args).length > 0;

export const KEY_FORMS: Readonly<Partial<Record<RunCommandId, KeyForm>>> = {
  'selection.paste': PASTE_AT_CELL,
  'overlay.grid': {
    args: [{ name: 'value', kind: 'enum', values: GRID_MODES, labels: GRID_LABELS, optional: true, description: 'The grid to draw: the active tool\'s, the object grid, the terrain grid, or none; left out, the command turns the grid off or back on.' }],
    current: () => store().gridMode,
    run({ value }, key) {
      if (value === undefined) key();
      else store().setGridMode(value as GridMode);
      return `overlay.grid is now ${store().gridMode}.`;
    },
  },
  'overlay.chunks': switchForm('overlay.chunks', () => store().showChunkBounds, (on) => store().setShowChunkBounds(on)),
  'overlay.numbers': switchForm('overlay.numbers', () => store().showLayerNumbers, (on) => store().setShowLayerNumbers(on)),
  'view.toggle': {
    args: [{ name: 'value', kind: 'enum', values: VIEW_MODES, optional: true, description: 'The view to show; left out, the command switches to the other one.' }],
    current: () => store().viewMode,
    run({ value }, key) {
      if (value === undefined) key();
      else if (value === '3d' && !hasWebGL2()) return refuse('This device cannot show the 3D view.');
      else store().setViewMode(value as ViewMode);
      return `view.toggle is now ${store().viewMode}.`;
    },
  },
  'app.export_image': {
    args: [
      { name: 'preset', kind: 'enum', values: EXPORT_PRESETS, optional: true, description: 'share draws the PetitGlyph band another editor reads the map from; plain draws none.' },
      ...imageSwitchNames.map((name): OptionalArg => ({ name, kind: 'boolean', optional: true, description: IMAGE_SWITCH_NOTES[name] })),
      { name: 'resolution', kind: 'enum', values: RESOLUTION_KEYS, optional: true, description: 'The picture size.' },
      { name: 'shots', kind: 'number', integer: true, min: MIN_SHOTS, max: MAX_SHOTS, optional: true, description: 'How many 3D thumbnails the 3D card holds.' },
      { name: 'footer_text', kind: 'string', optional: true, description: `The footer line: plain text with tags in braces (${FOOTER_TOKENS.map(({ id }) => `{${id}}`).join(', ')}); {${FOOTER_FILL}} pushes what follows to the right. At most ${FOOTER_TEMPLATE_MAX} characters.` },
    ],
    current() {
      const o = openingExportOptions();
      const on = imageSwitchNames.filter((name) => o[IMAGE_SWITCHES[name]]);
      return `preset ${o.preset}, resolution ${o.resolution}, on: ${on.join(', ') || 'none'}, 3D shots: ${exportShots().length}`;
    },
    async run(args, key) {
      if (!given(args) && !store().modals.share) { key(); return CONFIRM; }
      const opened = openingExportOptions();
      // The edition's preset first, so a part the same call names stands over the preset's choice of it.
      const options: ExportOptions = args.preset === undefined ? { ...opened } : applyExportPreset(opened, args.preset as ExportOptions['preset']);
      if (args.resolution !== undefined) options.resolution = args.resolution as ExportOptions['resolution'];
      for (const name of imageSwitchNames) if (args[name] !== undefined) options[IMAGE_SWITCHES[name]] = args[name] === true;
      if (args.footer_text !== undefined) {
        const template = String(args.footer_text);
        if (template.length > FOOTER_TEMPLATE_MAX) return refuse(`footer_text holds at most ${FOOTER_TEMPLATE_MAX} characters.`);
        const unknown = unknownFooterTokens(template);
        if (unknown.length > 0) return refuse(`The footer has no tag called ${unknown.join(', ')}.`);
        options.footerTemplate = template;
      }
      if (args.shots !== undefined && !setExportShotCount(Number(args.shots))) return refuse(NO_MAP);
      if (given(args)) prepareImageExport(options);
      await showShare('friend');
      return CONFIRM;
    },
  },
  'app.export_json': {
    args: [
      ...FILE_SWITCHES.map((name): OptionalArg => ({
        name, kind: 'boolean', optional: true,
        description: name === 'pretty' ? 'Write the file indented.' : `Carry the ${name} section.`,
      })),
      { name: 'history_depth', kind: 'enum', values: HISTORY_DEPTHS, optional: true, description: 'How much of the step history the history section carries.' },
    ],
    async run(args, key) {
      if (!given(args) && !store().modals.share) { key(); return CONFIRM; }
      const choices: Partial<JsonSections> = {};
      for (const name of FILE_SWITCHES) if (args[name] !== undefined) choices[name] = args[name] === true;
      if (args.history_depth !== undefined) choices.historyDepth = args.history_depth as JsonSections['historyDepth'];
      if (given(args)) prepareFileExport(choices);
      await showShare('keep');
      return CONFIRM;
    },
  },
};

export const UNBOUND_COMMANDS: readonly Command[] = [
  {
    id: 'settings.language', effect: 'change', target: 'app', labelKey: 'modal.settings_language',
    description: 'The interface language.',
    args: [{ name: 'value', kind: 'enum', values: LOCALES, description: 'The locale to switch to.' }],
    current: () => store().locale,
    invoke({ value }) {
      if (!isLocale(value)) return refuse('Unknown locale.');
      switchLocale(value);
      return `The interface language switches to ${value} once its strings have loaded.`;
    },
  },
  {
    id: 'settings.interface_zoom', effect: 'change', target: 'app', labelKey: 'modal.settings_ui_scale',
    description: 'The size of the interface, 1 being the default; the map zoom is separate.',
    args: [{ name: 'value', kind: 'number', min: UI_ZOOM_MIN, max: UI_ZOOM_MAX, description: 'The scale factor.' }],
    current: () => store().uiZoom,
    invoke({ value }) {
      store().setUiZoom(Number(value));
      return `settings.interface_zoom is now ${store().uiZoom}.`;
    },
  },
  choice<MotionPref>(
    { id: 'settings.motion', labelKey: 'modal.settings_motion', description: 'Interface animation: follow the system, reduced, or full.' },
    MOTION_PREFS, () => store().motionPref, (value) => store().setMotionPref(value),
    { system: 'modal.settings_motion_system', reduced: 'modal.settings_motion_reduced', full: 'modal.settings_motion_full' },
  ),
  {
    id: 'view.layer_visible', effect: 'change', target: 'app', labelKey: 'a11y.toggle_visibility',
    description: 'Shows or hides one layer of the map. Hiding a layer drops the selection on it.',
    args: [LAYER_ARG, { name: 'visible', kind: 'boolean', description: 'Whether the layer is shown.' }],
    current() {
      const hidden = Object.entries(store().layerVisibility).filter(([, shown]) => shown === false).map(([elevation]) => Number(elevation));
      return hidden.length > 0 ? `hidden layers: ${layerList(hidden)}` : 'every layer is shown';
    },
    invoke({ layer, visible }) {
      store().setLayerVisibility(elevationOf(layer), visible === true);
      return `Layer ${String(layer)} is now ${visible ? 'shown' : 'hidden'}.`;
    },
  },
  {
    id: 'view.layer_locked', effect: 'change', target: 'app', labelKey: 'a11y.toggle_lock',
    description: 'Locks or unlocks one layer of the map; a locked layer takes no edits.',
    args: [LAYER_ARG, { name: 'locked', kind: 'boolean', description: 'Whether the layer is locked.' }],
    current() {
      const locked = [...(store().gridState?.lockedLayers ?? [])];
      return locked.length > 0 ? `locked layers: ${layerList(locked)}` : 'no layer is locked';
    },
    invoke({ layer, locked }) {
      const elevation = elevationOf(layer);
      store().setLayerLocked(elevation, locked === true);
      return store().gridState?.lockedLayers.has(elevation) === locked
        ? `Layer ${String(layer)} is now ${locked ? 'locked' : 'unlocked'}.` : refuse(NOT_TAKEN);
    },
  },
  toggle(
    { id: 'view.annotations', labelKey: 'annot.layer', description: 'Whether the planning annotations layer is shown.' },
    () => store().gridState?.annotations?.visible !== false, (on) => store().setAnnotationsVisible(on),
  ),
  toggle(
    { id: 'view.annotations_locked', labelKey: 'a11y.toggle_lock', description: 'Whether the planning annotations layer is locked; a locked layer takes no edits to its notes.' },
    () => store().gridState?.annotations?.locked === true, (on) => store().setAnnotationsLocked(on),
  ),
  toggle(
    { id: 'view.interface_hidden', labelKey: 'a11y.hide_ui', description: 'Hides the whole interface so only the map shows, or shows it again.' },
    () => interfaceHidden(store()), (on) => store().setInterfaceHidden(on),
  ),
  {
    id: 'window.status', effect: 'answer', target: 'app', labelKey: 'modal.window',
    description: 'Lists the windows that are open.',
    args: [],
    invoke() {
      const open = MODAL_IDS.filter((id) => store().modals[id]);
      return open.length > 0 ? `Open windows: ${open.join(', ')}.` : 'No window is open.';
    },
  },
  {
    id: 'window.open', effect: 'change', target: 'app', labelKey: 'modal.window',
    description: 'Opens one of the app\'s windows. newProject is Change planet, share is Save and share; import is where the user chooses a file to open, and opening it reads nothing.',
    args: [
      { name: 'window', kind: 'enum', values: OPENABLE_WINDOWS, labels: WINDOW_LABELS, description: 'The window to open.' },
      { name: 'section', kind: 'enum', values: SHARE_SECTIONS, optional: true, description: 'For share only: keep is the save file, friend the share picture, stats the build checklist.' },
      { name: 'page', kind: 'string', optional: true, description: 'For help only: the id of the Help page to open at.' },
      { name: 'anchor', kind: 'string', optional: true, description: 'For help with a page only: the part of that page to open at.' },
    ],
    async invoke({ window: id, section, page, anchor }) {
      if (id === 'import' && !SUPPORTS_PICTURE_IMPORT) return refuse('This edition has no Import window.');
      if (!sessionOpens(framePose(store()), id as ModalId)) {
        return refuse('A planet is being edited or the map is under repair, where that window is not offered; finish that first.');
      }
      if (id === 'share' && section !== undefined) await showShare(section as ShareSection);
      else if (id === 'help' && typeof page === 'string') store().openHelpAt(typeof anchor === 'string' && anchor ? { page, anchor } : { page });
      else store().setModal(id as ModalId, true);
      return `The ${String(id)} window is open.`;
    },
  },
];
