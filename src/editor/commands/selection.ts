/**
 * The commands of the surfaces that stand on the map: the selection card, the map's menu and the
 * verb row over selected notes. Each runs the verb its button runs and refuses where its target
 * does not offer it (`editing/object-menu.ts`, `editing/annotation-edit.ts:noteSelectionTarget`), so
 * a notice the button raises is raised here too.
 */
import { PLANET_MAX_CELLS } from '../../core/model/planet';
import { ROTATIONS, type Rotation } from '../../core/model/types';
import { localizedName } from '../../i18n/context';
import type { I18nKey } from '../../i18n/keys';
import { getCatalogItem } from '../../state/catalog';
import { pasteOffered } from '../../state/clipboard';
import { useEditorStore } from '../../state/store';
import { flipMeasures, mergeZones, noteSelectionTarget } from '../editing/annotation-edit';
import { saveSelectionAsBlueprint } from '../editing/blueprint';
import { pasteAtCell } from '../editing/clipboard';
import { narrowSelectionTo, peelTerrainAt, rotateObjectTo } from '../editing/group-edit';
import { liveSelectionTarget, menuTarget, pickObject } from '../editing/object-menu';
import { pickSelection } from '../editing/pick-selection';
import { type Command, type CommandArg, type CommandArgs, type CommandResult, type CommandValue, type OptionalArg, refuse } from './types';

const store = () => useEditorStore.getState();

const ANGLES: readonly string[] = ROTATIONS.map(String);
const ANGLE_LABELS: Readonly<Partial<Record<string, I18nKey>>> = Object.fromEntries(ROTATIONS.map((angle) => [String(angle), `context.rotate_${angle}`]));

/** The name the interface shows for the catalog item `id`. */
function itemName(id: string): string | undefined {
  const item = getCatalogItem(id);
  return item ? localizedName(item.name, store().locale) : undefined;
}

/** The name the interface shows for the placed object `id`: its item's. */
function objectName(id: string): string | undefined {
  const object = store().gridState?.objects.get(id);
  return object ? itemName(object.catalogId) : undefined;
}

/** The object a command acts on in the selection's place, as the map's menu acts on the one it was opened on. */
const OBJECT_ARG: OptionalArg = {
  name: 'object', kind: 'string', optional: true, shown: objectName,
  description: 'The id of a placed object to act on in the selection\'s place, as the map\'s menu acts on the object it was opened on.',
};

const NO_OBJECT = 'No object on the map has that id.';
const FACING_REFUSED = 'The rules refused that facing; the object stands as it was.';

/** A map cell's coordinate. A custom planet's side is the widest a map gets. */
const cellArg = (name: 'x' | 'y', description: string): CommandArg => ({ name, kind: 'number', integer: true, min: 0, max: PLANET_MAX_CELLS - 1, description });

/** A coordinate of the cell a copy is pasted on, which may lie off the map: the copy lands at the nearest place it fits. */
const pasteArg = (name: 'x' | 'y'): OptionalArg => ({
  name, kind: 'number', integer: true, min: -PLANET_MAX_CELLS, max: 2 * PLANET_MAX_CELLS, optional: true,
  description: `The ${name} of the placement cell the copy's top-left goes on, as the map menu's Paste puts it on the pressed cell; given with ${name === 'x' ? 'y' : 'x'}. Left out, the copy goes where the paste key aims.`,
});

/** What `selection.paste` takes beside its key: the cell the map menu's Paste names (EDIT-56). */
export const PASTE_AT_CELL = {
  args: [pasteArg('x'), pasteArg('y')] as const,
  run({ x, y }: CommandArgs, key: () => void): CommandResult {
    if (x === undefined && y === undefined) { key(); return 'selection.paste ran.'; }
    if (x === undefined || y === undefined) return refuse('x and y are given together.');
    const s = store();
    if (!pasteOffered(s)) return refuse(s.clipboard ? 'Paste is not offered in a planet session or a hand repair.' : 'Nothing is copied.');
    pasteAtCell({ x: Number(x), y: Number(y) });
    return `One copy was pasted with its top-left on (${Number(x)}, ${Number(y)}), or the nearest place it fits; a notice says where it could not go.`;
  },
};

/** Turns `object` to `angle` where `offered`, saying which object it was. */
function face(object: { id: string; rotation: Rotation } | null, offered: boolean, angle: CommandValue | undefined, refusal: string): CommandResult {
  if (!object || !offered) return refuse(refusal);
  const placed = store().gridState?.objects.get(object.id);
  if (!placed) return refuse(NO_OBJECT);
  return rotateObjectTo(placed, Number(angle) as Rotation) ? `The object faces ${String(angle)}.` : refuse(FACING_REFUSED);
}

export const SELECTION_COMMANDS: readonly Command[] = [
  {
    id: 'selection.face', effect: 'change', target: 'map', labelKey: 'selection.facing',
    description: 'Turns one object to face an angle, as one undo step: the one selected object, as the selection card\'s facing does, or the object named, as the map menu\'s facings do.',
    args: [
      { name: 'angle', kind: 'enum', values: ANGLES, labels: ANGLE_LABELS, description: 'The facing in degrees: the item\'s front faces south at 0, and each step is a quarter turn clockwise.' },
      OBJECT_ARG,
    ],
    current() {
      const target = liveSelectionTarget(store());
      return target?.faceable && target.object ? String(target.object.rotation) : 'none';
    },
    invoke({ angle, object }) {
      if (object === undefined) {
        const target = liveSelectionTarget(store());
        return face(target?.object ?? null, !!target?.faceable, angle, 'The selection is not one object that can be turned to a facing.');
      }
      const target = menuTarget({ kind: 'object', id: String(object) }, store());
      return face(target?.object ?? null, !!target?.rotatable, angle, target ? 'That object does not turn.' : NO_OBJECT);
    },
  },
  {
    id: 'selection.pick', effect: 'change', target: 'map', labelKey: 'a11y.pick_material',
    description: 'Arms what the one selected block is made of for placing again and puts the selection down, as Pick on the selection card does; with an object named, that object, as Pick in a finger\'s map menu does.',
    args: [OBJECT_ARG],
    invoke({ object }) {
      if (object === undefined) {
        if (!liveSelectionTarget(store())?.pickable) return refuse('The selection is not one block whose material can be picked.');
        pickSelection();
        return 'What the selection is made of is armed for placing.';
      }
      const target = menuTarget({ kind: 'object', id: String(object) }, store());
      if (!target?.pickable) return refuse(target ? 'That object\'s item cannot be armed again.' : NO_OBJECT);
      pickObject(String(object));
      return 'The object\'s item is armed for placing.';
    },
  },
  {
    id: 'selection.save_blueprint', effect: 'change', target: 'map', labelKey: 'blueprint.save_as',
    description: 'Opens Blueprint mode with the frame step drawn around the selected objects, as Save as blueprint on the selection card does. Nothing is saved until the frame and the save step are confirmed.',
    args: [],
    invoke() {
      if (!liveSelectionTarget(store())?.blueprintable) return refuse('The selection holds no object a blueprint can capture, or Blueprint mode cannot open now.');
      return saveSelectionAsBlueprint() ? 'Blueprint mode is open with the frame drawn around the selection.' : refuse('The frame step did not open.');
    },
  },
  {
    id: 'selection.narrow', effect: 'change', target: 'map', labelKey: 'selection.kinds',
    description: 'Narrows a selection of several objects to those of one item, as a kind row of the selection card does; one selection step.',
    args: [{ name: 'item', kind: 'string', shown: itemName, description: 'The catalog id of the item to keep selected.' }],
    invoke({ item }) {
      if (!liveSelectionTarget(store())?.plural) return refuse('Several objects must be selected to narrow them to one kind.');
      return narrowSelectionTo(String(item)) ? `The selection holds only its objects of ${String(item)}.` : refuse('The selection holds no object of that item.');
    },
  },
  {
    id: 'notes.merge', effect: 'change', target: 'map', labelKey: 'annot.merge',
    description: 'Merges the selected zones into the first one picked, which keeps its tag, number and colour, as one step of the Notes history; other selected notes stay as they are and leave the selection.',
    args: [],
    invoke() {
      const target = noteSelectionTarget(store());
      if (!target?.mergeable) return refuse('Two or more zones must be selected to merge them.');
      if (target.locked) return refuse('The notes layer is locked.');
      mergeZones([...target.ids]);
      return 'The selected zones are one zone.';
    },
  },
  {
    id: 'notes.flip', effect: 'change', target: 'map', labelKey: 'annot.flip',
    description: 'Draws each selected measurement on its other side, as one step of the Notes history; other selected notes stay as they are.',
    args: [],
    invoke() {
      const target = noteSelectionTarget(store());
      if (!target?.flippable) return refuse('No measurement is selected.');
      if (target.locked) return refuse('The notes layer is locked.');
      flipMeasures([...target.ids]);
      return 'The selected measurements are flipped.';
    },
  },
  {
    id: 'terrain.peel', effect: 'change', target: 'map', labelKey: 'context.delete',
    description: 'Peels the top layer of mountain or water off one cell, as one undo step, as Delete in the map\'s menu does on a cell; the selection empties.',
    args: [cellArg('x', 'The terrain cell\'s column.'), cellArg('y', 'The terrain cell\'s row.')],
    invoke({ x, y }) {
      const cell = { kind: 'terrain', x: Number(x), y: Number(y) } as const;
      if (!menuTarget(cell, store())?.peelable) return refuse('That cell holds no mountain or water to peel.');
      return peelTerrainAt(cell.x, cell.y) ? `One layer was peeled off (${cell.x}, ${cell.y}).` : refuse('The rules refused it; the cell stands as it was.');
    },
  },
];
