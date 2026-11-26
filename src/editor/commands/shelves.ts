/**
 * The commands the shelves' and the notes bar's own controls press: arming an item or a planting
 * card, clearing the painted region, finishing or dropping the note being drawn, the note tags and
 * the notes options. Each runs the verb its control ran, so a card, a pill and any other caller
 * reach one state by one path; all act on the map and the tool in hand.
 */
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { SELECTABLE_ANNOTATION_TAGS } from '../../config/annotation-tags';
import { CUSTOM_TAG_TEXT_MAX, chipTextSize, isCustomTagId, type NoteTag, type ZoneTextSize } from '../../core/model/annotations';
import { localizedName, translate } from '../../i18n/context';
import type { I18nKey } from '../../i18n/keys';
import { tagLabel } from '../../i18n/terms/annotation-tags';
import { getCatalogItem } from '../../state/catalog';
import { armedItemOf, armedMacroOf, armedPicksOf, isAnnotating } from '../../state/editing/edit-mode';
import { keyContext } from '../../state/keymap/toolbar';
import { shelfOffers } from '../../state/object-shelf-view';
import { useEditorStore } from '../../state/store';
import { approvedTexts } from '../../state/text-verdicts';
import { SHELF_MACRO_IDS, macroLabel, type MacroId } from '../../tools/macros';
import { ZONE_TEXT_SIZES } from '../../tools/pointer/annotate/index';
import { addOrArmTag, discardDraft, draftAwaitsDone } from '../editing/annotation-edit';
import { toggleArmedItem, toggleArmedMacro, toggleItemPick } from '../editing/object-shelf';
import { clearRegion } from '../editing/region-brush';
import { givenNameIssue } from '../review/text-review';
import { noteSizeInHand } from './commands';
import { type Command, type CommandResult, refuse, NAME_ISSUES } from './types';

const store = () => useEditorStore.getState();
const NOT_TAKEN = 'The app did not take the change in its present state.';

/** What `current` reads where nothing is armed. */
const NOTHING = 'none';

const NOTES_SHUT = 'Notes is not open; mode.set opens it.';

const SIZE_LABELS: Readonly<Record<ZoneTextSize, I18nKey>> = { s: 'annot.size_s', m: 'annot.size_m', l: 'annot.size_l', none: 'annot.size_none' };

/** The map's custom tags the tag row shows: those whose text the check approved. */
const shownCustomTags = () => approvedTexts(store().gridState?.annotations?.customTags ?? []);

/** Whether the tag row offers `tag`: a preset it lists or a custom tag it shows. */
function tagOffered(tag: string): tag is NoteTag {
  return SELECTABLE_ANNOTATION_TAGS.some((entry) => entry.id === tag) || shownCustomTags().some((entry) => entry.id === tag);
}

/** The label the tag row shows for `tag`. */
function tagShown(tag: string): string | undefined {
  return tagOffered(tag) ? tagLabel(tag, store().locale, store().gridState?.annotations?.customTags) || undefined : undefined;
}

/** The name the shelf shows for the item `id`. */
const itemShown = (id: string): string | undefined => {
  const item = getCatalogItem(id);
  return item ? localizedName(item.name, store().locale) : undefined;
};

export const SHELF_COMMANDS: readonly Command[] = [
  {
    id: 'objects.arm', effect: 'change', target: 'map', labelKey: 'mode.object',
    description: 'Presses an item\'s card on the object shelf: arms the item for placing and opens Objects, or puts it down when it is the only one armed. With add, the press adds the item to the armed ones, or takes it out.',
    args: [
      { name: 'item', kind: 'string', shown: itemShown, description: 'The catalog id of an item the shelf offers.' },
      { name: 'add', kind: 'boolean', optional: true, description: 'Whether the item joins the items already armed, as a Ctrl press on its card does.' },
    ],
    current: () => armedItemOf(store()) ?? NOTHING,
    invoke({ item, add }) {
      const id = String(item);
      if (!shelfOffers(id, store().planetSession !== null)) return refuse(`The object shelf offers no item with the id ${id}.`);
      if (add === true) toggleItemPick(id);
      else toggleArmedItem(id);
      if (store().editMode.mode !== 'object') return refuse(NOT_TAKEN);
      return armedPicksOf(store()).includes(id) ? `${id} is armed.` : `${id} was put down.`;
    },
  },
  {
    id: 'objects.planting', effect: 'change', target: 'map', labelKey: 'smart.patch',
    description: 'Presses a planting card on the object shelf: arms that planting and opens Objects, or puts it down when it is the one armed.',
    args: [{
      name: 'macro', kind: 'enum', values: SHELF_MACRO_IDS, labels: Object.fromEntries(SHELF_MACRO_IDS.flatMap((id) => { const key = macroLabel(id); return key ? [[id, key]] : []; })),
      description: 'The planting card: patch-tree stands in the trees\' tab, patch-flora in the flowers\'.',
    }],
    current: () => SHELF_MACRO_IDS.find((id) => id === armedMacroOf(store())) ?? NOTHING,
    invoke({ macro }) {
      if (store().planetSession) return refuse('The shelf offers no planting while a planet is being edited.');
      toggleArmedMacro(macro as MacroId);
      if (store().editMode.mode !== 'object') return refuse(NOT_TAKEN);
      return armedMacroOf(store()) === macro ? `${String(macro)} is armed.` : `${String(macro)} was put down.`;
    },
  },
  {
    id: 'region.clear', effect: 'change', target: 'map', labelKey: 'generate.clear',
    description: 'Clears the region being painted, as Clear on the region bar does; the brush stays in hand.',
    args: [],
    invoke() {
      if (!store().selectingRegion) return refuse('No region is being painted.');
      clearRegion();
      return 'The painted region was cleared.';
    },
  },
  {
    id: 'notes.draft', effect: 'change', target: 'map', labelKey: 'annot.done',
    description: 'Finishes the zone or route being drawn in Notes, as Done does, or throws it away, as Discard does.',
    args: [{ name: 'keep', kind: 'boolean', description: 'true keeps the note on the map; false discards it.' }],
    invoke({ keep }) {
      if (!draftAwaitsDone(store().annotationDraft)) return refuse('No zone or route is being drawn that could be finished.');
      if (keep === true) return store().commitAnnotationDraft() ? 'The note was added to the map.' : refuse(NOT_TAKEN);
      discardDraft();
      return 'The note being drawn was discarded.';
    },
  },
  {
    id: 'notes.tag', effect: 'change', target: 'map', labelKey: 'annot.tag',
    description: 'Presses a tag on the Notes tag row: arms the tag, which the note being drawn and the selected notes take too. Pressing the armed tag clears a zone\'s tag, while a chip keeps one.',
    args: [{ name: 'tag', kind: 'string', shown: tagShown, description: 'A preset tag id, or the id of one of the map\'s own tags the row shows.' }],
    current: () => store().annotationTag ?? NOTHING,
    invoke({ tag }) {
      if (!isAnnotating(store())) return refuse(NOTES_SHUT);
      const id = String(tag);
      if (!tagOffered(id)) return refuse(`The tag row offers no tag with the id ${id}.`);
      store().pickAnnotationTag(id);
      return `notes.tag is now ${store().annotationTag ?? NOTHING}.`;
    },
  },
  {
    id: 'notes.tag_add', effect: 'change', target: 'map', labelKey: 'annot.tag_add',
    description: 'Adds a tag of the map\'s own to the Notes tag row and arms it; a name the row already shows arms that tag instead.',
    args: [{ name: 'name', kind: 'string', description: `The tag's name, at most ${CUSTOM_TAG_TEXT_MAX} characters.` }],
    invoke({ name }): CommandResult | Promise<CommandResult> {
      if (!isAnnotating(store())) return refuse(NOTES_SHUT);
      const typed = String(name).trim();
      if (!typed) return refuse('name must not be blank.');
      if (typed.length > CUSTOM_TAG_TEXT_MAX) return refuse(`name must be at most ${CUSTOM_TAG_TEXT_MAX} characters.`);
      const add = (): CommandResult => {
        const tag = addOrArmTag(typed, translate, store().gridState?.annotations?.customTags ?? []);
        return tag ? `notes.tag is now ${tag}.` : refuse('The map holds as many tags of its own as it can.');
      };
      const check = givenNameIssue(typed, '', 'tag');
      return check === null ? add() : check.then((issue) => (issue === null ? add() : refuse(NAME_ISSUES[issue])));
    },
  },
  {
    id: 'notes.tag_remove', effect: 'change', target: 'map', labelKey: 'annot.tag_remove_mode',
    description: 'Removes one of the map\'s own tags from the Notes tag row, and from every note that wears it. Undo in Notes brings it back.',
    args: [{ name: 'tag', kind: 'string', shown: tagShown, description: 'The id of one of the map\'s own tags the row shows.' }],
    invoke({ tag }) {
      if (!isAnnotating(store())) return refuse(NOTES_SHUT);
      const id = String(tag);
      if (!isCustomTagId(id) || !shownCustomTags().some((entry) => entry.id === id)) return refuse(`The tag row shows no tag of the map's own with the id ${id}.`);
      store().removeCustomTag(id);
      return `The tag ${id} was removed.`;
    },
  },
  {
    id: 'notes.size', effect: 'change', target: 'map', labelKey: 'annot.size',
    description: 'The text size of the zone or chip tool in hand, as its key steps it, which the note being drawn and the selected notes take too. A zone may carry no text; a chip always carries its own.',
    args: [{ name: 'value', kind: 'enum', values: ZONE_TEXT_SIZES, labels: SIZE_LABELS, description: 'The size to set.' }],
    current: () => noteSizeInHand()?.value ?? chipTextSize(store().annotationSize),
    invoke({ value }) {
      const inHand = noteSizeInHand();
      if (!inHand) return refuse('The notes tool in hand takes no text size.');
      const size = inHand.sizes.find((known) => known === value);
      if (size === undefined) return refuse(`value must be one of: ${inHand.sizes.join(', ')}.`);
      store().setAnnotationSize(size);
      return `notes.size is now ${size}.`;
    },
  },
  {
    id: 'notes.dimensions', effect: 'change', target: 'map', labelKey: 'region.dimensions',
    description: 'Whether a zone shows its width and height while it is drawn with the zone brush.',
    args: [{ name: 'on', kind: 'boolean', description: 'Whether the dimensions show.' }],
    current: () => store().annotationDimensions,
    invoke({ on }) {
      if (keyContext(store()) !== 'notes-zone') return refuse('Only the zone brush shows dimensions.');
      store().setAnnotationDimensions(on === true);
      return `notes.dimensions is now ${on === true ? 'on' : 'off'}.`;
    },
  },
  {
    id: 'notes.route_dashed', effect: 'change', target: 'map', labelKey: 'annot.line_style',
    description: 'Whether the route tool in hand draws a dashed line; the route being drawn and the selected routes take it too.',
    args: [{ name: 'on', kind: 'boolean', description: 'true draws dashes; false a solid line.' }],
    current: () => store().annotationRouteDashed,
    invoke({ on }) {
      if (keyContext(store()) !== 'notes-route') return refuse('Only the route tool takes a line style.');
      store().setAnnotationRouteDashed(on === true);
      return `notes.route_dashed is now ${on === true ? 'on' : 'off'}.`;
    },
  },
  {
    id: 'notes.color', effect: 'change', target: 'map', labelKey: 'annot.color',
    description: 'The colour new notes are drawn in, which the note being drawn and the selected notes take too.',
    args: [{ name: 'value', kind: 'enum', values: ANNOTATION_COLORS, description: 'One of the swatches of the Notes colour row.' }],
    current: () => store().annotationColor,
    invoke({ value }) {
      if (!isAnnotating(store())) return refuse(NOTES_SHUT);
      store().setAnnotationColor(String(value));
      return `notes.color is now ${String(value)}.`;
    },
  },
];
