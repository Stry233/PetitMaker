// @vitest-environment jsdom
/**
 * Custom note tags: the map carries its own list beside its notes, saves and share codes carry
 * both, older files load as before, and only text with an approving verdict is drawn or leaves the
 * browser. The slice adds, applies and removes them through annotation history.
 */
import '../../_support/pixi-env';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Text, type Container } from 'pixi.js-legacy';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { decodeAnnotations } from '../../../io/save/annotations-codec';
import { canonicalize, toSaveJSON } from '../../../io/save/canonical';
import { decodeMapPayload, encodeMapPayload } from '../../../io/share/codec/payload';
import { exportable } from '../../_support/exportable';
import { tagLabel } from '../../../i18n/terms/annotation-tags';
import { AnnotationLayer } from '../../../view/map2d/layers/annotation-layer';
import { __resetTextVerdicts, recordTextVerdict } from '../../../state/text-verdicts';
import { setReducedMotion, __resetMotionState } from '../../../platform/channels/motion-state';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState, makeTemplate } from '../../_support/map-state';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import type { AnnotationsState, ChipNote, CustomTagId, ZoneNote } from '../../../core/model/annotations';

const ORCHARD: CustomTagId = 'custom:orchard-row';
const PIER: CustomTagId = 'custom:north-pier';

const notes = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }], color: '#FF8A7A', tag: ORCHARD, num: 1 },
    { kind: 'zone', id: 'z2', cells: [{ x: 5, y: 5 }], color: '#FF8A7A', tag: 'homes', num: 2 },
    { kind: 'chip', id: 'c1', x: 5.5, y: 6, tag: PIER, size: 'l', color: '#FFB347' },
  ],
  customTags: [{ id: ORCHARD, text: 'Orchard row' }, { id: PIER, text: 'North pier' }],
  visible: true,
  locked: false,
});

const texts = (node: Container): string[] => node instanceof Text ? [node.text] : node.children.flatMap((child) => texts(child as Container));

afterEach(() => __resetTextVerdicts());

describe('custom tags in saves and share codes', () => {
  it('round-trip through a save with the notes that wear them', () => {
    const state = makeState(12, 12);
    state.annotations = notes();
    const back = deserialize(serialize(state), state.template).annotations!;
    expect(back.customTags).toEqual(notes().customTags);
    expect((back.items[0] as ZoneNote).tag).toBe(ORCHARD);
    expect((back.items[2] as ChipNote).tag).toBe(PIER);
  });

  it('round-trip through a share code payload', async () => {
    const state = createGridState(getMapTemplate('hexia'));
    state.annotations = notes();
    const decoded = await decodeMapPayload(await encodeMapPayload(state, null, { appVersion: 'custom-tags', saveVersion: 1 }));
    expect(decoded.annotations?.customTags).toEqual(notes().customTags);
    expect(decoded.annotations?.items.map((n) => ('tag' in n ? n.tag : null))).toEqual([ORCHARD, 'homes', PIER]);
    const shared = deserialize(toSaveJSON(canonicalize(state), state.annotations), state.template).annotations!;
    expect(shared.customTags).toEqual(notes().customTags);
  });

  it('keep a list no note wears yet', () => {
    const state = makeState(8, 8);
    state.annotations = { items: [], customTags: [{ id: ORCHARD, text: 'Orchard row' }], visible: true, locked: false };
    expect(deserialize(serialize(state), state.template).annotations?.customTags).toEqual([{ id: ORCHARD, text: 'Orchard row' }]);
  });

  it('leave a save from before custom tags as it was', () => {
    const back = decodeAnnotations({ items: [notes().items[1]], visible: true, locked: false })!;
    expect(back).not.toHaveProperty('customTags');
    expect((back.items[0] as ZoneNote).tag).toBe('homes');
  });

  it('read a tag the map does not carry as no tag, and drop a chip that wears one', () => {
    const back = decodeAnnotations({ ...notes(), customTags: [] })!;
    expect(back.items).toHaveLength(2);
    expect((back.items[0] as ZoneNote).tag).toBeNull();
  });

  it('trim, bound and deduplicate the list', () => {
    const back = decodeAnnotations({
      items: [],
      customTags: [
        { id: ORCHARD, text: '  Orchard row  ' },
        { id: PIER, text: 'Orchard row' },
        { id: 'custom:blank', text: '   ' },
        { id: 'homes', text: 'Preset id' },
        { id: 'custom:long', text: 'x'.repeat(200) },
        { id: ORCHARD, text: 'Second use of an id' },
      ],
    })!;
    expect(back.customTags!.map((t) => t.id)).toEqual([ORCHARD, 'custom:long']);
    expect(back.customTags![0]!.text).toBe('Orchard row');
    expect(back.customTags![1]!.text.length).toBe(24);
  });
});

describe('only approved custom tag text is drawn', () => {
  beforeEach(() => setReducedMotion(true));
  afterEach(() => __resetMotionState());

  it('labels a custom tag only once its text is approved', () => {
    const custom = notes().customTags;
    expect(tagLabel(ORCHARD, 'en', custom)).toBe('');
    recordTextVerdict('Orchard row', false);
    expect(tagLabel(ORCHARD, 'en', custom)).toBe('');
    recordTextVerdict('Orchard row', true);
    expect(tagLabel(ORCHARD, 'en', custom)).toBe('Orchard row');
    expect(tagLabel('homes', 'en', custom)).toBe('Homes');
  });

  it('draws no unreviewed text on the 2D layer, and draws it once approved', () => {
    const layer = new AnnotationLayer(() => {});
    const data = notes();
    const draw = () => layer.draw(data, { draft: null, selectionIds: [], inkScale: 1, tagLabel: (tag) => tagLabel(tag, 'en', data.customTags) });
    draw();
    expect(texts(layer.container)).not.toContain('Orchard row');
    expect(texts(layer.container)).not.toContain('North pier');
    recordTextVerdict('Orchard row', true);
    draw();
    expect(texts(layer.container)).toContain('Orchard row');
    expect(texts(layer.container)).not.toContain('North pier');
    layer.destroy();
  });

  it('hands on only approved tags, leaving their zones untagged and dropping their chips', () => {
    recordTextVerdict('Orchard row', true);
    const state = makeState(8, 8);
    state.annotations = notes();
    const shown = exportable(state).annotations!;
    expect(shown.customTags).toEqual([{ id: ORCHARD, text: 'Orchard row' }]);
    expect(shown.items.map((n) => n.id)).toEqual(['z1', 'z2']);
    expect(state.annotations.customTags).toHaveLength(2);
    recordTextVerdict('North pier', true);
    expect(exportable(state)).toBe(state);
  });
});

describe('custom tags in the annotation slice', () => {
  const s = () => useEditorStore.getState();
  const items = () => s().gridState!.annotations!.items;
  beforeEach(() => {
    s().initMap(makeTemplate(10, 10), createDefaultRegistry());
    s().setAnnotationTool('none');
    s().addAnnotation({ kind: 'zone', id: 'z', cells: [{ x: 1, y: 1 }], color: '#FF8A7A', tag: 'homes', num: 1 });
    s().addAnnotation({ kind: 'zone', id: 'other', cells: [{ x: 4, y: 4 }], color: '#FF8A7A', tag: 'farm', num: 2 });
    s().setAnnotationSelection(['z']);
  });

  it('adds a tag, arms it and applies it to the selection as one lane entry', () => {
    const lane = s().annotationUndoLane.length;
    const id = s().addCustomTag('  Orchard row ')!;
    expect(s().gridState!.annotations!.customTags).toEqual([{ id, text: 'Orchard row' }]);
    expect(s().annotationTag).toBe(id);
    expect(items().map((n) => (n as ZoneNote).tag)).toEqual([id, 'farm']);
    expect(s().annotationUndoLane).toHaveLength(lane + 1);
    s().undoAnnotation();
    expect(s().gridState!.annotations!.customTags).toBeUndefined();
    expect((items()[0] as ZoneNote).tag).toBe('homes');
  });

  it('arms the tag it already carries for the same text', () => {
    const id = s().addCustomTag('Orchard row')!;
    s().setAnnotationTag(null);
    expect(s().addCustomTag('Orchard row')).toBe(id);
    expect(s().gridState!.annotations!.customTags).toHaveLength(1);
    expect(s().annotationTag).toBe(id);
  });

  it('removes a tag as one lane entry, and undo brings it and its zone back', () => {
    const id = s().addCustomTag('Orchard row')!;
    s().addAnnotation({ kind: 'chip', id: 'c', x: 3, y: 3, tag: id, size: 'm', color: '#FFB347' });
    const lane = s().annotationUndoLane.length;
    s().removeCustomTag(id);
    expect(s().annotationUndoLane).toHaveLength(lane + 1);
    expect(s().gridState!.annotations!.customTags).toBeUndefined();
    expect(items().map((n) => n.id)).toEqual(['z', 'other']);
    expect((items()[0] as ZoneNote).tag).toBeNull();
    expect(s().annotationTag).toBeNull();
    s().undoAnnotation();
    expect(s().gridState!.annotations!.customTags).toEqual([{ id, text: 'Orchard row' }]);
    expect(items().map((n) => n.id)).toEqual(['z', 'other', 'c']);
    expect((items()[0] as ZoneNote).tag).toBe(id);
    s().redoAnnotation();
    expect(s().gridState!.annotations!.customTags).toBeUndefined();
  });
});
