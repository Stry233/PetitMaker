/** The commands over the save-and-share window's choices that are not a switch of `app.export_image`
 *  or `app.export_json`. Each runs the verb its control runs; none starts a download. */
import { NOTE_LIMITS } from '../../core/model/notes';
import { noteAttribution } from '../../state/notes-attribution';
import { translate } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { selectedVersion, versionStore } from '../../state/stylize-versions';
import { MAX_SHOTS } from '../../state/shot-list';
import { addExportShot, exportShots, removeExportShot } from '../export/shots';
import { type Command, refuse, NO_MAP } from './types';

const store = () => useEditorStore.getState();

const NOTE_FIELDS = ['title', 'description'] as const;

/** The value naming the map's own picture where a take's id would stand. */
const ORIGINAL = 'original';
const takeCalled = (id: string) => versionStore.getState().versions.find((version) => version.id === id);
/** A take as the shelf names it. */
const shownTake = (id: string): string | undefined => {
  if (id === ORIGINAL) return translate('stylize.original');
  const take = takeCalled(id);
  return take ? translate('stylize.version_label', { n: take.no }) : undefined;
};
const takeIds = (): string => versionStore.getState().versions.map((version) => version.id).join(', ') || 'none';

export const EXPORT_COMMANDS: readonly Command[] = [
  {
    id: 'map.notes', effect: 'change', target: 'map', labelKey: 'export.json_notes',
    description: 'Sets the map\'s title and description, the words its share picture, save file and share code carry. A field left out stays as it is and an empty one is cleared; the words are checked when the map is exported.',
    args: NOTE_FIELDS.map((name) => ({
      name, kind: 'string', optional: true, description: `The ${name}, cut to ${NOTE_LIMITS[name]} characters.`,
    })),
    current() {
      const { title = '', description = '' } = store().gridState?.notes ?? {};
      return `title: ${JSON.stringify(title)}, description: ${JSON.stringify(description)}`;
    },
    invoke(args) {
      const map = store().gridState;
      if (!map) return refuse(NO_MAP);
      const held = noteAttribution(map);
      // A map read from a picture keeps that picture's words until it has changed enough.
      const locked = NOTE_FIELDS.find((name) => held[`${name}Locked`] && args[name] !== undefined && args[name] !== held.notes[name]);
      if (locked) return refuse(`The ${locked} is the imported picture's own and cannot be changed yet.`);
      const given = Object.fromEntries(NOTE_FIELDS.flatMap((name) => (args[name] === undefined ? [] : [[name, String(args[name])]])));
      store().setMapNotes({ ...held.notes, ...given });
      return 'The map\'s title and description are set.';
    },
  },
  {
    id: 'export.illustration', effect: 'change', target: 'app', labelKey: 'stylize.entry',
    description: 'Chooses the picture of the map the share picture carries: one of this session\'s illustration takes, or the map as drawn. Takes are made in the Map illustration window, and a map edit retires them.',
    args: [{ name: 'version', kind: 'string', shown: shownTake, description: `A take's id, or ${ORIGINAL} for the map as drawn.` }],
    current: () => selectedVersion()?.id ?? ORIGINAL,
    invoke({ version }) {
      const id = String(version);
      if (id !== ORIGINAL && !takeCalled(id)) return refuse(`No illustration take is called ${id}; the takes are: ${takeIds()}.`);
      versionStore.select(id === ORIGINAL ? null : id);
      return id === ORIGINAL ? 'The share picture carries the map as drawn.' : `The share picture carries take ${id}.`;
    },
  },
  {
    id: 'export.illustration_retire', effect: 'change', target: 'app', labelKey: 'stylize.retire',
    description: 'Removes one illustration take from this session\'s shelf; a take chosen for the share picture gives way to the map as drawn.',
    args: [{ name: 'version', kind: 'string', shown: shownTake, description: 'The take\'s id.' }],
    invoke({ version }) {
      const id = String(version);
      if (!takeCalled(id)) return refuse(`No illustration take is called ${id}; the takes are: ${takeIds()}.`);
      versionStore.retire(id);
      return `Take ${id} is removed.`;
    },
  },
  {
    id: 'export.shot_add', effect: 'change', target: 'app', labelKey: 'export.shot_add',
    description: 'Adds one 3D thumbnail to the share picture\'s 3D card.',
    args: [],
    current: () => exportShots().length,
    invoke() {
      if (!store().gridState) return refuse(NO_MAP);
      if (!addExportShot()) return refuse(`The 3D card holds at most ${MAX_SHOTS} thumbnails.`);
      return `The 3D card now holds ${exportShots().length} thumbnails.`;
    },
  },
  {
    id: 'export.shot_remove', effect: 'change', target: 'app', labelKey: 'export.shot_delete',
    description: 'Removes one 3D thumbnail from the share picture\'s 3D card; the last one stays.',
    args: [{ name: 'index', kind: 'number', integer: true, min: 0, max: MAX_SHOTS - 1, description: 'The thumbnail\'s place in the row, the first being 0.' }],
    current: () => exportShots().length,
    invoke({ index }) {
      if (!store().gridState) return refuse(NO_MAP);
      if (!removeExportShot(Number(index))) return refuse('The 3D card has no such thumbnail, or it is the only one left.');
      return `The 3D card now holds ${exportShots().length} thumbnails.`;
    },
  },
];
