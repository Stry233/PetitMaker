/** The shelves' and the notes bar's commands over the live store: each does what its control does, refuses a bad value and then changes nothing. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ANNOTATION_COLORS } from '../../../config/annotation-palette';
import { ItemCategory } from '../../../config/catalog/categories';
import { CUSTOM_TAG_TEXT_MAX, type MapAnnotation } from '../../../core/model/annotations';
import { listCommands, runCommand } from '../../../editor/commands/run';
import { reviewText } from '../../../pipelines/moderation/text/reviewer';
import { createDefaultRegistry } from '../../../rules';
import { getCatalogByCategory, getRoadMaterials } from '../../../state/catalog';
import { armedItemOf, armedMacroOf, armedPicksOf } from '../../../state/editing/edit-mode';
import { regionOf } from '../../../state/editing/region';
import { placesOneAtATime } from '../../../state/object-geometry';
import { useEditorStore } from '../../../state/store';
import { makeTemplate } from '../../_support/map-state';
import { resetStore } from '../../_support/store';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((command) => command.id === id)?.current;
const run = async (id: string, args: Record<string, unknown> = {}) => {
  const outcome = await runCommand(id, args);
  expect(outcome, `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: true });
};
const refused = async (id: string, args: Record<string, unknown> = {}) => {
  expect(await runCommand(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
};
const notes = () => s().gridState!.annotations;
const openNotes = () => runCommand('mode.set', { mode: 'annotate' });

const ZONE: MapAnnotation = { kind: 'zone', id: 'z', cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }], color: ANNOTATION_COLORS[0]!, tag: null, num: 1 };

beforeEach(() => {
  resetStore();
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
});

describe('the object shelf\'s cards', () => {
  const [first, second] = getCatalogByCategory(ItemCategory.Tree).filter((item) => !placesOneAtATime(item)).map((item) => item.id) as [string, string];

  it('objects.arm arms an item as a press on its card does, puts the armed one down, and adds to the armed ones', async () => {
    await run('objects.arm', { item: first });
    expect([s().editMode.mode, armedItemOf(s()), current('objects.arm')]).toEqual(['object', first, first]);
    await run('objects.arm', { item: first });
    expect([armedItemOf(s()), current('objects.arm')]).toEqual([null, 'none']);

    await run('objects.arm', { item: first });
    await run('objects.arm', { item: second, add: true });
    expect(armedPicksOf(s())).toEqual([first, second]);
    await run('objects.arm', { item: second, add: true });
    expect(armedPicksOf(s())).toEqual([first]);
  });

  it('objects.arm refuses an id the shelf does not offer, and arms nothing', async () => {
    await refused('objects.arm', { item: 'no-such-item' });
    await refused('objects.arm', { item: getRoadMaterials()[0]!.id });
    await refused('objects.arm');
    expect([s().editMode.mode, armedItemOf(s())]).toEqual([null, null]);
  });

  it('objects.planting arms a planting card and puts the armed one down', async () => {
    await run('objects.planting', { macro: 'patch-tree' });
    expect([s().editMode.mode, armedMacroOf(s()), current('objects.planting')]).toEqual(['object', 'patch-tree', 'patch-tree']);
    await run('objects.planting', { macro: 'patch-flora' });
    expect(armedMacroOf(s())).toBe('patch-flora');
    await run('objects.planting', { macro: 'patch-flora' });
    expect([armedMacroOf(s()), current('objects.planting')]).toEqual([null, 'none']);
  });

  it('objects.planting refuses a macro that is no planting card, and any while a planet is edited', async () => {
    await refused('objects.planting', { macro: 'raise' });
    useEditorStore.setState({ planetSession: { entryId: null } as never });
    await refused('objects.planting', { macro: 'patch-tree' });
    expect([s().editMode.mode, armedMacroOf(s())]).toEqual([null, null]);
  });
});

describe('region.clear', () => {
  it('clears the region being painted and keeps the brush, and does nothing with no region being painted', async () => {
    s().setRegion([{ x: 4, y: 4 }, { x: 5, y: 4 }], 'generator');
    await refused('region.clear');
    expect(regionOf(s(), 'generator')).toHaveLength(2);

    s().setSelectingRegion(true, 'generator');
    await run('region.clear');
    expect(regionOf(s(), 'generator')).toEqual([]);
    expect(s().selectingRegion).toBe(true);
  });
});

describe('the note being drawn', () => {
  it('notes.draft keeps the note on the map as Done does, or discards it', async () => {
    await openNotes();
    s().setAnnotationDraft(ZONE);
    await run('notes.draft', { keep: true });
    expect([s().annotationDraft, notes()?.items.map((n) => n.id)]).toEqual([null, ['z']]);

    s().setAnnotationDraft({ ...ZONE, id: 'y' });
    await run('notes.draft', { keep: false });
    expect([s().annotationDraft, notes()?.items.map((n) => n.id)]).toEqual([null, ['z']]);
  });

  it('notes.draft refuses with nothing drawn that Done would finish', async () => {
    await openNotes();
    await refused('notes.draft', { keep: true });
    const measure: MapAnnotation = { kind: 'measure', id: 'm', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }], color: ANNOTATION_COLORS[0]! };
    s().setAnnotationDraft(measure);
    await refused('notes.draft', { keep: true });
    await refused('notes.draft', { keep: 'yes' });
    expect([s().annotationDraft, notes()?.items ?? []]).toEqual([measure, []]);
  });
});

describe('the tag row', () => {
  it('notes.tag arms a tag as its pill does, and a second press clears a zone\'s tag', async () => {
    await openNotes();
    await run('notes.tag', { tag: 'shops' });
    expect([s().annotationTag, current('notes.tag')]).toEqual(['shops', 'shops']);
    await run('notes.tag', { tag: 'shops' });
    expect([s().annotationTag, current('notes.tag')]).toEqual([null, 'none']);
  });

  it('notes.tag refuses a tag the row does not offer, and outside Notes', async () => {
    await refused('notes.tag', { tag: 'shops' });
    await openNotes();
    const armed = s().annotationTag;
    await refused('notes.tag', { tag: 'castle' });
    await refused('notes.tag', { tag: 'workshop' });
    expect(s().annotationTag).toBe(armed);
  });

  it('notes.tag_add adds a checked name to the map\'s tags and arms it, and a name the row shows arms that tag', async () => {
    await openNotes();
    await run('notes.tag_add', { name: '  Pond ' });
    const [pond] = notes()!.customTags!;
    expect([pond!.text, s().annotationTag]).toEqual(['Pond', pond!.id]);

    await run('notes.tag', { tag: 'shops' });
    await run('notes.tag_add', { name: 'pond' });
    expect([notes()!.customTags, s().annotationTag]).toEqual([[pond], pond!.id]);
  });

  it('notes.tag_add refuses a blank or overlong name and one the name check refuses, adding nothing', async () => {
    await openNotes();
    await refused('notes.tag_add', { name: '   ' });
    await refused('notes.tag_add', { name: 'x'.repeat(CUSTOM_TAG_TEXT_MAX + 1) });
    vi.mocked(reviewText).mockResolvedValueOnce({ allowed: false } as never);
    await refused('notes.tag_add', { name: 'Marsh' });
    expect(notes()?.customTags ?? []).toEqual([]);
  });

  it('notes.tag_remove removes one of the map\'s own tags, and refuses a preset', async () => {
    await openNotes();
    await run('notes.tag_add', { name: 'Pond' });
    const id = notes()!.customTags![0]!.id;
    await refused('notes.tag_remove', { tag: 'shops' });
    await refused('notes.tag_remove', { tag: 'custom:none-such' });
    expect(notes()!.customTags).toHaveLength(1);

    await run('notes.tag_remove', { tag: id });
    expect([notes()!.customTags ?? [], s().annotationTag]).toEqual([[], null]);
  });
});

describe('the notes options, set to a value', () => {
  it('notes.size sets the zone\'s or the chip\'s text size, and a chip takes no "none"', async () => {
    await openNotes();
    s().setAnnotationTool('zone');
    await run('notes.size', { value: 'none' });
    expect([s().annotationSize, current('notes.size')]).toEqual(['none', 'none']);

    s().setAnnotationTool('chip');
    await refused('notes.size', { value: 'none' });
    await refused('notes.size', { value: 'huge' });
    await run('notes.size', { value: 'l' });
    expect([s().annotationSize, current('notes.size')]).toEqual(['l', 'l']);

    s().setAnnotationTool('route');
    await refused('notes.size', { value: 's' });
    expect(s().annotationSize).toBe('l');
  });

  it('notes.dimensions shows or hides a zone\'s width and height, for the zone brush alone', async () => {
    await openNotes();
    s().setAnnotationTool('zone');
    await run('notes.dimensions', { on: false });
    expect([s().annotationDimensions, current('notes.dimensions')]).toEqual([false, false]);
    s().setAnnotationTool('route');
    await refused('notes.dimensions', { on: true });
    await refused('notes.dimensions', { on: 'show' });
    expect(s().annotationDimensions).toBe(false);
  });

  it('notes.route_dashed sets the route\'s line style, for the route tool alone', async () => {
    await openNotes();
    s().setAnnotationTool('route');
    await run('notes.route_dashed', { on: false });
    expect([s().annotationRouteDashed, current('notes.route_dashed')]).toEqual([false, false]);
    s().setAnnotationTool('zone');
    await refused('notes.route_dashed', { on: true });
    expect(s().annotationRouteDashed).toBe(false);
  });

  it('notes.color sets the colour as its swatch does, and refuses one the row does not hold', async () => {
    const before = s().annotationColor;
    await refused('notes.color', { value: ANNOTATION_COLORS[3] });
    await openNotes();
    await refused('notes.color', { value: '#123456' });
    expect(s().annotationColor).toBe(before);
    await run('notes.color', { value: ANNOTATION_COLORS[3] });
    expect([s().annotationColor, current('notes.color')]).toEqual([ANNOTATION_COLORS[3], ANNOTATION_COLORS[3]]);
  });
});
