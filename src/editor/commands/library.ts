/**
 * The commands over the two libraries: the blueprint library's folders, names and order, and the
 * saved planets with the planet the map stands on and the planet editor's session (its start, its
 * leave and its save). Each calls the verb its control calls, so a
 * notice the control raises is raised here too. A name a caller gives passes the text check a name
 * field runs before it is written; nothing here deletes a blueprint, a folder or a planet. A file
 * goes out only behind the export notice its caller's context shows (`CommandContext.exportNotice`).
 */
import { BLUEPRINT_NAME_MAX } from '../../io/blueprint';
import { PLANET_NAME_MAX } from '../../io/save/planet-codec';
import type { TextField } from '../../pipelines/moderation/facts';
import { regionOf } from '../../state/editing/region';
import { blueprintSavable } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import {
  addBlueprintFolder, arrangeBlueprints, blueprintFolderName, blueprintFolders, exportBlueprints, fileBlueprints, renameBlueprint,
  renameBlueprintFolder, setAsideBlueprints, shownBlueprints,
} from '../editing/blueprint';
import {
  BLUEPRINT_MAX_SIDE, armBlueprint, authorAllowed, beginBlueprintFrame, confirmBlueprintFrame, foldBlueprintLibraryForFrame, frameRefusal,
  knownAuthor, saveFramedFields, takeBlueprintFromLibrary, type CaptureRefusal,
} from '../editing/blueprint';
import { sessionHasGround } from '../operations/planet-session';
import { givenNameIssue } from '../review/text-review';
import {
  finishPlanetEditing, leavingLosesWork, openPlanetEditor, planetEditingRefusal, sessionPlanetName, stopPlanetEditing,
} from '../session/planet-editing';
import { renamePlanetEntry, shownPlanetEntries } from '../session/planet-library';
import { shownPlanetName } from '../session/planet-names';
import { changePlanet, planetPick, type PlanetChoice } from '../session/planet-switch';
import { type Command, type CommandArg, type CommandRefusal, type CommandResult, type CommandValue, refuse, NO_MAP, NAME_ISSUES } from './types';

const store = () => useEditorStore.getState();
const quoted = (name: string): string => `"${name}"`;

/** The most blueprints or planets a listing names; it says how many it left out. */
const LIST_CAP = 60;

const NOT_SAVED = 'The browser could not save the change.';

/**
 * Runs `write` once `name` may be written as the name of something in `field` that shows `known`;
 * refused where it is blank, past `max`, the name already shown or refused by the text check. A name
 * the check has already answered for is written before this returns, as its control writes it.
 */
function withName(
  name: string, known: string, field: TextField, max: number, write: () => CommandResult | Promise<CommandResult>,
): CommandResult | Promise<CommandResult> {
  if (!name) return refuse('name must not be blank.');
  if (name.length > max) return refuse(`name must be at most ${max} characters.`);
  if (name === known) return refuse(`It is already named ${quoted(name)}.`);
  const check = givenNameIssue(name, known, field);
  return check === null ? write() : check.then((issue) => (issue === null ? write() : refuse(NAME_ISSUES[issue])));
}

const trimmed = (value: CommandValue | undefined): string => String(value ?? '').trim();

/** The blueprints `ids` names, comma-separated, each once in the order given, or the first id the library does not show. */
function blueprintsNamed(ids: CommandValue | undefined): { ids: string[] } | { unknown: string } {
  const named = [...new Set(String(ids ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
  const shown = new Set(shownBlueprints().map((r) => r.id));
  const unknown = named.find((id) => !shown.has(id));
  return unknown === undefined ? { ids: named } : { unknown };
}

/** The folder `value` names: by its id as blueprints.list gives it, else, since a built-in folder's id
 *  opens with a space a caller may drop, by its id trimmed or the name it shows; undefined for none. */
function folderNamed(value: CommandValue): string | undefined {
  const asked = String(value);
  const folders = blueprintFolders();
  return folders.find((f) => f === asked) ?? folders.find((f) => f.trim() === asked.trim()) ?? folders.find((f) => blueprintFolderName(f) === asked.trim());
}

const noBlueprint = (id: string): CommandRefusal => refuse(id ? `No blueprint has the id ${id}; blueprints.list gives the ids.` : 'ids must name at least one blueprint.');
const noFolder = (id: string): CommandRefusal => refuse(`No folder has the id ${id}; blueprints.list gives the ids.`);
const counted = (n: number): string => (n === 1 ? '1 blueprint' : `${n} blueprints`);

/** The names the library shows for the blueprints `ids` names, comma-separated; an id it does not show stays as given. */
function blueprintNames(ids: string): string {
  const names = new Map(shownBlueprints().map((r) => [r.id, r.name]));
  return ids.split(',').map((id) => id.trim()).filter(Boolean).map((id) => names.get(id) ?? id).join(', ');
}

/** The name the library shows for the folder `value` names. */
const folderShown = (value: string): string | undefined => {
  const folder = folderNamed(value);
  return folder === undefined ? undefined : blueprintFolderName(folder);
};

/** Why no command of the Blueprint bar runs now, or null: its controls stand only in Blueprint mode. */
const outsideBlueprintMode = (): CommandRefusal | null => (
  store().editMode.mode === 'blueprint' ? null : refuse('Blueprint mode is not open; mode.set opens it.')
);

const FRAME_REFUSALS: Readonly<Record<CaptureRefusal, string>> = {
  'too-big': `A blueprint can be at most ${BLUEPRINT_MAX_SIDE} by ${BLUEPRINT_MAX_SIDE} cells.`,
  'too-small': 'The frame must hold at least one whole cell; draw a rectangle around what to save.',
  landmark: 'The frame includes a fixed building, which a blueprint cannot hold.',
  empty: 'There is nothing to save inside the frame.',
};

const IDS_ARG: CommandArg = { name: 'ids', kind: 'string', shown: blueprintNames, description: 'One blueprint id from blueprints.list, or several separated by commas.' };
const FOLDER_ID = 'A folder id from blueprints.list.';

const BLUEPRINT_COMMANDS: readonly Command[] = [
  {
    id: 'blueprints.list', effect: 'answer', target: 'app', labelKey: 'mode.blueprint',
    description: `Lists the blueprint library as JSON: its folders (id, name, count) and its blueprints (id, name, folder id, size in cells), at most ${LIST_CAP} blueprints.`,
    args: [{ name: 'folder', kind: 'string', optional: true, description: `${FOLDER_ID} Lists only the blueprints in it.` }],
    invoke({ folder }) {
      const folders = blueprintFolders();
      const only = folder === undefined ? undefined : folderNamed(folder);
      if (folder !== undefined && only === undefined) return noFolder(String(folder));
      const all = shownBlueprints();
      const listed = only === undefined ? all : all.filter((r) => r.folder === only);
      return JSON.stringify({
        folders: folders.map((id) => ({ id, name: blueprintFolderName(id), count: all.filter((r) => r.folder === id).length })),
        blueprints: listed.slice(0, LIST_CAP).map((r) => ({ id: r.id, name: r.name, folder: r.folder, size: `${r.body.w}x${r.body.h}` })),
        ...(listed.length > LIST_CAP ? { omitted: listed.length - LIST_CAP } : {}),
      });
    },
  },
  {
    id: 'blueprints.rename', effect: 'change', target: 'app', labelKey: 'blueprint.rename_title',
    description: 'Renames one blueprint of the library.',
    args: [
      { name: 'id', kind: 'string', shown: blueprintNames, description: 'The blueprint id from blueprints.list.' },
      { name: 'name', kind: 'string', description: `The new name, at most ${BLUEPRINT_NAME_MAX} characters.` },
    ],
    invoke({ id, name }) {
      const record = shownBlueprints().find((r) => r.id === id);
      if (!record) return noBlueprint(String(id));
      const next = trimmed(name);
      return withName(next, record.name, 'blueprint-name', BLUEPRINT_NAME_MAX, async () => (
        await renameBlueprint(record.id, next) ? `Blueprint ${quoted(record.name)} is now named ${quoted(next)}.` : refuse(NOT_SAVED)
      ));
    },
  },
  {
    id: 'blueprints.move', effect: 'change', target: 'app', labelKey: 'blueprint.move',
    description: 'Files blueprints under a folder of the library, or under none.',
    args: [IDS_ARG, { name: 'folder', kind: 'string', optional: true, shown: folderShown, description: `${FOLDER_ID} Left out, the blueprints are taken out of every folder.` }],
    async invoke({ ids, folder }) {
      const named = blueprintsNamed(ids);
      if ('unknown' in named) return noBlueprint(named.unknown);
      if (named.ids.length === 0) return noBlueprint('');
      const to = folder === undefined ? null : folderNamed(folder);
      if (to === undefined) return noFolder(String(folder));
      if (!(await fileBlueprints(named.ids, to))) return refuse(NOT_SAVED);
      return to === null
        ? `${counted(named.ids.length)} taken out of every folder.`
        : `${counted(named.ids.length)} moved to the folder ${quoted(blueprintFolderName(to))}.`;
    },
  },
  {
    id: 'blueprints.set_aside', effect: 'change', target: 'app', labelKey: 'blueprint.pending_delete_folder',
    description: 'Files blueprints under the folder for pending deletion, made when the library has none. Nothing is deleted: the user deletes that folder, or moves a blueprint back out of it.',
    args: [IDS_ARG],
    async invoke({ ids }) {
      const named = blueprintsNamed(ids);
      if ('unknown' in named) return noBlueprint(named.unknown);
      if (named.ids.length === 0) return noBlueprint('');
      const folder = await setAsideBlueprints(named.ids);
      return folder === null ? refuse(NOT_SAVED)
        : `${counted(named.ids.length)} moved to the folder ${quoted(blueprintFolderName(folder))} (id ${folder}); nothing was deleted, the user deletes that folder themselves.`;
    },
  },
  {
    id: 'blueprints.reorder', effect: 'change', target: 'app', labelKey: 'blueprint.reorder',
    description: 'Moves blueprints together to a place in the library\'s own order, which the library shows while no column sorts it. Give exactly one of before and after.',
    args: [
      IDS_ARG,
      { name: 'before', kind: 'string', optional: true, description: 'The id of the blueprint they are set down just before.' },
      { name: 'after', kind: 'string', optional: true, description: 'The id of the blueprint they are set down just after.' },
    ],
    async invoke({ ids, before, after }) {
      const named = blueprintsNamed(ids);
      if ('unknown' in named) return noBlueprint(named.unknown);
      if (named.ids.length === 0) return noBlueprint('');
      if ((before === undefined) === (after === undefined)) return refuse('Give exactly one of before and after.');
      const beside = String(before ?? after);
      const anchor = shownBlueprints().find((r) => r.id === beside);
      if (!anchor) return noBlueprint(beside);
      if (named.ids.includes(beside)) return refuse('The blueprint to set them down beside must not be one of those moved.');
      if (!(await arrangeBlueprints(named.ids, before !== undefined ? { before: beside } : { after: beside }))) return refuse(NOT_SAVED);
      const sorted = store().blueprint.sort !== null ? ' The library is sorted by a column now, so this order shows once that sorting is off.' : '';
      return `${counted(named.ids.length)} set down just ${before !== undefined ? 'before' : 'after'} ${quoted(anchor.name)}.${sorted}`;
    },
  },
  {
    id: 'blueprints.folder_create', effect: 'change', target: 'app', labelKey: 'blueprint.new_folder',
    description: 'Creates a folder in the blueprint library and opens it there. A name a folder already shows gets a number appended.',
    args: [{ name: 'name', kind: 'string', description: `The folder name, at most ${BLUEPRINT_NAME_MAX} characters.` }],
    invoke({ name }) {
      const asked = trimmed(name);
      return withName(asked, '', 'blueprint-folder', BLUEPRINT_NAME_MAX, () => {
        const used = addBlueprintFolder(asked);
        if (!used) return refuse('The library did not take this folder name.');
        store().setBlueprintUi({ folder: used, selected: [] });
        return `The folder ${quoted(blueprintFolderName(used))} (id ${used}) was created and is open in the library.`;
      });
    },
  },
  {
    id: 'blueprints.folder_rename', effect: 'change', target: 'app', labelKey: 'blueprint.folder_rename',
    description: 'Renames a folder of the blueprint library, with the blueprints in it. The folder of the user\'s own blueprints keeps its name.',
    args: [
      { name: 'folder', kind: 'string', shown: folderShown, description: FOLDER_ID },
      { name: 'name', kind: 'string', description: `The new name, at most ${BLUEPRINT_NAME_MAX} characters.` },
    ],
    invoke({ folder, name }) {
      const from = folderNamed(folder!);
      if (from === undefined) return noFolder(String(folder));
      const was = blueprintFolderName(from);
      const next = trimmed(name);
      return withName(next, was, 'blueprint-folder', BLUEPRINT_NAME_MAX, async () => {
        const outcome = await renameBlueprintFolder(from, next);
        if (outcome === 'fixed') return refuse(`The folder ${quoted(was)} keeps its name.`);
        if (outcome === 'taken') return refuse(`A folder already shows the name ${quoted(next)}.`);
        return outcome === 'failed' ? refuse(NOT_SAVED) : `The folder ${quoted(was)} is now named ${quoted(next)}.`;
      });
    },
  },
  {
    id: 'blueprints.export', effect: 'outward', target: 'app', labelKey: 'blueprint.export',
    description: 'Downloads blueprints as one file: the ones ids names, or every blueprint of a folder. Give exactly one of ids and folder. The export notice opens first, and the file is written only once the user has read and accepted it there.',
    args: [
      { ...IDS_ARG, optional: true },
      { name: 'folder', kind: 'string', optional: true, shown: folderShown, description: `${FOLDER_ID} Exports every blueprint in it.` },
    ],
    async invoke({ ids, folder }, ctx) {
      if ((ids === undefined) === (folder === undefined)) return refuse('Give exactly one of ids and folder.');
      let which: readonly string[] | { folder: string };
      if (folder !== undefined) {
        const from = folderNamed(folder);
        if (from === undefined) return noFolder(String(folder));
        which = { folder: from };
      } else {
        const named = blueprintsNamed(ids);
        if ('unknown' in named) return noBlueprint(named.unknown);
        if (named.ids.length === 0) return noBlueprint('');
        which = named.ids;
      }
      if (!ctx.exportNotice) return refuse('The export notice cannot be shown here, so no file is written.');
      const outcome = await exportBlueprints(which, { confirmNotice: ctx.exportNotice });
      if (outcome === 'no-files') return refuse('This edition writes no files.');
      if (outcome === 'none') return refuse('That folder holds no blueprint.');
      if (outcome === 'declined') return refuse('The user did not accept the export notice, so no file was written.');
      return `${counted(outcome.exported)} written to one file, which the browser downloaded.`;
    },
  },
  {
    id: 'blueprints.arm', effect: 'change', target: 'map', labelKey: 'mode.blueprint',
    description: 'Arms a blueprint of the library, as a press on its card does, so the next press on the map places it once; an open library explorer folds first. With no id, puts down the armed blueprint.',
    args: [{ name: 'id', kind: 'string', optional: true, shown: blueprintNames, description: 'The blueprint id from blueprints.list. Left out, nothing is armed.' }],
    current: () => store().blueprint.armed ?? '',
    invoke({ id }) {
      const outside = outsideBlueprintMode();
      if (outside) return outside;
      const { at } = store().blueprintStep;
      if (at === 'frame' || at === 'save') return refuse('A frame is being drawn or saved; finish or cancel it first.');
      if (id === undefined) {
        armBlueprint(null);
        return 'No blueprint is armed.';
      }
      const record = shownBlueprints().find((r) => r.id === id);
      if (!record) return noBlueprint(String(id));
      takeBlueprintFromLibrary(record.id);
      return store().blueprint.armed === record.id ? `Blueprint ${quoted(record.name)} is armed; a press on the map places it.` : refuse('The blueprint could not be armed.');
    },
  },
  {
    id: 'blueprints.frame', effect: 'change', target: 'map', labelKey: 'blueprint.new',
    description: 'Opens the frame step for a new blueprint, as New blueprint does: the region brush frames one rectangle, and blueprints.frame_done confirms it. An open library explorer folds first.',
    args: [{
      name: 'from', kind: 'enum', values: ['strip', 'explorer'], optional: true,
      description: 'Where Cancel returns to: the strip, or the library explorer, which unfolds again. Left out, the explorer when it is open, else the strip.',
    }],
    invoke({ from }) {
      const outside = outsideBlueprintMode();
      if (outside) return outside;
      const { at } = store().blueprintStep;
      if (at === 'frame' || at === 'save') return refuse('A frame is already being drawn or saved.');
      if (at === 'explorer') foldBlueprintLibraryForFrame();
      const start = from === undefined ? (at === 'explorer' ? 'explorer' : 'strip') : from === 'explorer' ? 'explorer' : 'strip';
      return beginBlueprintFrame(null, start) ? 'The frame step is open; draw a rectangle around what to save.' : refuse('The frame step did not open.');
    },
  },
  {
    id: 'blueprints.frame_done', effect: 'change', target: 'map', labelKey: 'generate.scope_done',
    description: 'Confirms the frame drawn in the frame step, as its Done does, and opens the save step on it. A frame that cannot be saved is refused with the reason.',
    args: [],
    invoke() {
      if (store().blueprintStep.at !== 'frame') return refuse('No frame step is open; blueprints.frame opens it.');
      if (confirmBlueprintFrame()) return 'The save step is open on the frame.';
      return refuse(FRAME_REFUSALS[frameRefusal(regionOf(store(), 'blueprint')) ?? 'too-small']);
    },
  },
  {
    id: 'blueprints.save', effect: 'change', target: 'app', labelKey: 'blueprint.save',
    description: 'Saves the frame the save step stands on as a blueprint of the library, as its Save does, and arms it. It runs only while the save step is open, which the user opens by framing a rectangle in Blueprint mode.',
    args: [
      { name: 'name', kind: 'string', optional: true, description: `The blueprint's name, at most ${BLUEPRINT_NAME_MAX} characters. Left out, it takes a numbered default.` },
      { name: 'author', kind: 'string', optional: true, description: `The author it names, at most ${BLUEPRINT_NAME_MAX} characters. Left out, it is saved anonymously.` },
      { name: 'folder', kind: 'string', optional: true, shown: folderShown, description: `${FOLDER_ID} Left out, it is filed under no folder.` },
    ],
    invoke({ name, author, folder }) {
      const step = store().blueprintStep;
      if (step.at !== 'save') return refuse('No frame is waiting to be saved; the save step opens once a frame is drawn and confirmed in Blueprint mode.');
      if (step.pending) return refuse('This frame is already being saved.');
      if (!blueprintSavable(store())) return refuse('Nothing is saved while a guided step is showing.');
      const named = trimmed(name);
      if (named.length > BLUEPRINT_NAME_MAX) return refuse(`name must be at most ${BLUEPRINT_NAME_MAX} characters.`);
      const by = author === undefined ? null : trimmed(author);
      if (by === '') return refuse('author must not be blank; leave it out to save anonymously.');
      if (by !== null && by.length > BLUEPRINT_NAME_MAX) return refuse(`author must be at most ${BLUEPRINT_NAME_MAX} characters.`);
      if (!authorAllowed(by)) return refuse('Here the author can only be the name the platform gives the user; leave author out to save anonymously.');
      const to = folder === undefined ? null : folderNamed(folder);
      if (to === undefined) return noFolder(String(folder));
      const save = async (): Promise<CommandResult> => {
        if (!(await saveFramedFields({ name: named, author: by ?? '', anonymous: by === null, folder: to }))) return refuse('The blueprint was not saved.');
        const saved = shownBlueprints().find((r) => r.id === store().blueprint.armed);
        return `The frame was saved as the blueprint ${quoted(saved?.name ?? named)}${to === null ? '' : ` in the folder ${quoted(blueprintFolderName(to))}`}, which is now armed.`;
      };
      // A text its field's check approved is saved within the press, as the save step's Save saves it.
      const checks = [
        named ? givenNameIssue(named, '', 'blueprint-name') : null,
        by ? givenNameIssue(by, knownAuthor(by), 'blueprint-author') : null,
      ];
      if (checks.every((check) => check === null)) return save();
      return Promise.all(checks).then(([nameIssue, authorIssue]) => {
        if (nameIssue) return refuse(NAME_ISSUES[nameIssue]);
        return authorIssue ? refuse(`author: ${NAME_ISSUES[authorIssue]}`) : save();
      });
    },
  },
];

/** `planetPick`'s inputs but for the pick: the saved planets as shown and the planet the map stands on. */
function planetInputs(): Omit<Parameters<typeof planetPick>[0], 'chosenKey'> {
  const { locale, gridState } = store();
  const template = gridState?.template;
  return { entries: shownPlanetEntries(locale), locale, here: template ? { template, name: shownPlanetName(template, locale) } : null };
}

/** The planets Change planet lists, with `chosenKey` picked among them, else the planet the map stands on. */
const planets = (chosenKey: string | null = null) => planetPick({ ...planetInputs(), chosenKey });

const PLANETS_LIST = 'A planet id from planets.list';
/** The name Change planet shows for the planet `id` names. */
const planetShown = (id: string): string | undefined => {
  const { builtin, mine } = planets();
  return [...builtin, ...mine].find((choice) => choice.key === id)?.name;
};
const shownChoice = ({ key, name }: PlanetChoice): { id: string; name: string } => ({ id: key, name });
const tally = ({ cells, objects }: { cells: number; objects: number }): string => `${cells} terrain cells and ${objects} objects`;

const PLANET_COMMANDS: readonly Command[] = [
  {
    id: 'planets.list', effect: 'answer', target: 'app', labelKey: 'planet.mine_group',
    description: `Lists the planets as JSON: the built-in ones, the saved ones (at most ${LIST_CAP}) and the id of the planet the map stands on.`,
    args: [],
    invoke() {
      const { builtin, mine, current, chosen } = planets();
      return JSON.stringify({
        current: store().gridState ? chosen.key : null,
        ...(current ? { unsaved: shownChoice(current) } : {}),
        builtin: builtin.map(shownChoice),
        saved: mine.slice(0, LIST_CAP).map(shownChoice),
        ...(mine.length > LIST_CAP ? { omitted: mine.length - LIST_CAP } : {}),
      });
    },
  },
  {
    id: 'planets.rename', effect: 'change', target: 'app', labelKey: 'planet.rename_title',
    description: 'Renames one saved planet. A built-in planet keeps its name.',
    args: [
      { name: 'planet', kind: 'string', shown: planetShown, description: `${PLANETS_LIST}, among the saved ones.` },
      { name: 'name', kind: 'string', description: `The new name, at most ${PLANET_NAME_MAX} characters.` },
    ],
    invoke({ planet, name }) {
      const entry = planets().mine.find((choice) => choice.key === planet)?.entry;
      if (!entry) return refuse(`No saved planet has the id ${String(planet)}; planets.list gives the ids.`);
      const next = trimmed(name);
      return withName(next, entry.name, 'planet', PLANET_NAME_MAX, () => (
        renamePlanetEntry(entry, next) ? `The planet ${quoted(entry.name)} is now named ${quoted(next)}.` : refuse(NOT_SAVED)
      ));
    },
  },
  {
    id: 'planets.switch', effect: 'outward', target: 'app', labelKey: 'modal.new_title',
    description: 'Moves the map to another planet, as Change planet does with the build carried along: what fits the new planet comes over and the rest is left behind, the Change planet window closes and the arrival notice says what came along. The undo history is discarded and cannot be brought back. Opening a planet empty is the user\'s own to do in the Change planet window.',
    args: [
      { name: 'planet', kind: 'string', shown: planetShown, description: `${PLANETS_LIST}: a built-in or a saved one, other than the planet the map stands on.` },
    ],
    current() {
      const { locale, gridState } = store();
      return gridState ? shownPlanetName(gridState.template, locale) : 'no map is open';
    },
    invoke({ planet }) {
      const { builtin, mine } = planets();
      const choice = [...builtin, ...mine].find((c) => c.key === planet);
      if (!choice) return refuse(`No planet has the id ${String(planet)}; planets.list gives the ids.`);
      const pick = planets(choice.key);
      if (pick.startingOver) return refuse(`The map already stands on ${quoted(choice.name)}.`);
      return new Promise<CommandResult>((resolve) => {
        const started = changePlanet(pick.target, true, (end) => {
          if (end === 'failed') {
            resolve(refuse('The switch failed and the open map stands as it was.'));
          } else if (store().gridState?.template.id !== choice.template.id) {
            resolve(`The build was carried towards ${quoted(choice.name)}, and it changes what stands under a landmark there, so the planet opens once the user has chosen in the repair window.`);
          } else if (end?.carried) {
            resolve(`The map now stands on ${quoted(choice.name)}. Carried over: ${tally(end.moved)}; left behind: ${tally(end.dropped)}. The undo history was discarded.`);
          } else {
            resolve(`The map now stands on ${quoted(choice.name)} with nothing to carry over. The undo history was discarded.`);
          }
        });
        if (!started) resolve(refuse('A planet switch is already under way.'));
      });
    },
  },
];

const NO_PLANET_SESSION = 'No planet is being edited; planet.edit opens the planet editor.';

const EDIT_REFUSALS: Readonly<Record<NonNullable<ReturnType<typeof planetEditingRefusal>>, string>> = {
  'no-map': NO_MAP,
  session: 'A planet is already being edited; planet.finish saves it and planet.leave leaves it.',
  note: 'A note is waiting for its discard question to be answered first.',
  tour: 'The welcome tips are running; the planet editor opens once they end.',
  job: 'The assistant is working on the map; the planet editor opens once its job ends.',
};

/** The planet editor's session over the map: the start Change planet's Edit shape and New planet
 *  press, and the nameplate's Back and Done. They act on the map, which the session sets aside. */
const PLANET_SESSION_COMMANDS: readonly Command[] = [
  {
    id: 'planet.edit', effect: 'change', target: 'map', labelKey: 'planet.edit',
    description: 'Opens the planet editor, as Edit shape and New planet do in Change planet: on a saved planet, or on an empty sea for a new one. The map that was open is set aside and comes back unchanged when the session ends.',
    args: [{ name: 'planet', kind: 'string', optional: true, shown: planetShown, description: `${PLANETS_LIST}, among the saved ones. Left out, a new planet is started.` }],
    invoke({ planet }) {
      const { builtin, mine } = planets();
      const choice = planet === undefined ? null : [...builtin, ...mine].find((c) => c.key === planet);
      if (choice === undefined) return refuse(`No planet has the id ${String(planet)}; planets.list gives the ids.`);
      if (choice && !choice.entry) return refuse(`${quoted(choice.name)} is a built-in planet, whose shape is fixed; only a saved planet or a new one opens in the planet editor.`);
      const refusal = planetEditingRefusal();
      if (refusal) return refuse(EDIT_REFUSALS[refusal]);
      if (!openPlanetEditor(choice?.entry ?? null)) return refuse('The planet editor did not open.');
      return choice ? `The planet editor is open on ${quoted(choice.name)}; the map that was open waits behind it.`
        : 'The planet editor is open on a new planet; the map that was open waits behind it.';
    },
  },
  {
    id: 'planet.leave', effect: 'destroy', target: 'map', labelKey: 'planet.back',
    description: 'Leaves the planet editor without saving the planet, as its Back does, and brings back the map that was open. A planet with changes, or one read from a video and not yet saved, is left only with discard, which throws that work away for good.',
    args: [{ name: 'discard', kind: 'boolean', optional: true, description: 'True to leave a planet whose changes would be lost; left out, such a planet stays open.' }],
    invoke({ discard }) {
      if (!store().planetSession) return refuse(NO_PLANET_SESSION);
      const loses = leavingLosesWork();
      if (!stopPlanetEditing({ discard: discard === true })) {
        return refuse('The planet has changes that leaving would discard, so it stays open; planet.finish saves it, and discard: true leaves without saving.');
      }
      return loses ? 'The planet editor was left and its unsaved planet discarded; the map that was open is back.'
        : 'The planet editor was left; the map that was open is back.';
    },
  },
  {
    id: 'planet.finish', effect: 'change', target: 'map', labelKey: 'planet.done',
    description: 'Saves the planet being edited to the saved planets, as Done does, and brings back the map that was open. A planet opened from a saved one replaces it unless copy is true.',
    args: [
      { name: 'name', kind: 'string', optional: true, description: `The planet's name, at most ${PLANET_NAME_MAX} characters. Left out, it keeps the name the nameplate shows.` },
      { name: 'copy', kind: 'boolean', optional: true, description: 'True to save a planet opened from a saved one as a new planet beside it.' },
    ],
    current: () => (store().planetSession ? sessionPlanetName() : ''),
    invoke({ name, copy }) {
      if (!store().planetSession) return refuse(NO_PLANET_SESSION);
      if (!sessionHasGround(store().gridState)) return refuse('The planet has no ground yet, so there is nothing to save.');
      const shown = sessionPlanetName();
      const named = name === undefined ? shown : trimmed(name);
      if (!named) return refuse('name must not be blank; leave it out to keep the name shown.');
      if (named.length > PLANET_NAME_MAX) return refuse(`name must be at most ${PLANET_NAME_MAX} characters.`);
      const save = (): CommandResult => {
        const result = finishPlanetEditing(named, copy === true);
        if (result.ok) return `The planet was saved as ${quoted(named)}; the map that was open is back.`;
        return refuse(result.reason === 'quota' ? NOT_SAVED : 'The planet could not be saved and is still open.');
      };
      // A name its field's check approved is saved within the press, as Done saves it.
      const check = givenNameIssue(named, shown, 'planet');
      return check === null ? save() : check.then((issue) => (issue === null ? save() : refuse(NAME_ISSUES[issue])));
    },
  },
];

export const LIBRARY_COMMANDS: readonly Command[] = [...BLUEPRINT_COMMANDS, ...PLANET_COMMANDS, ...PLANET_SESSION_COMMANDS];
