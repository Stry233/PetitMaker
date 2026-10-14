import { describe, expect, it } from 'vitest';
import { CommandType } from '../../../core/model/types';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { decodeHistory, encodeHistory } from '../../../io/save/history-codec';
import { applyOptionalSections } from '../../../io/import/sections-restore';
import { makeState } from '../../_support/map-state';

/** The history section version this build writes. */
const HISTORY_V = encodeHistory([], 'all').v;

function history(object: unknown, carrier: string) {
  const cmd = carrier === 'place'
    ? { type: CommandType.PlaceObject, object, loadValue: 0 }
    : carrier === 'remove'
      ? { type: CommandType.RemoveObject, objectId: 'bridge', removedObject: object }
      : { type: CommandType.PaintTerrain, cells: [], terrainType: 1, elevation: 1 };
  const objectOps = carrier === 'added' || carrier === 'removed'
    ? { added: carrier === 'added' ? [object] : [], removed: carrier === 'removed' ? [object] : [] }
    : undefined;
  return { v: HISTORY_V, totalSteps: 1, entries: [{ cmd, before: [], after: [], objectOps }] };
}

const object = { id: 'bridge', catalogId: 'bridge-plank', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };

describe('shared map and history object admission', () => {
  it.each([
    { spanLength: -1 }, { spanLength: 0 }, { spanLength: 1.5 }, { spanLength: 13 },
    { spanLength: NaN }, { spanLength: Infinity }, { spanLength: null },
    { x: -1 }, { x: 12 }, { x: 5.25 }, { rotation: 45 }, { elevation: -1 }, { elevation: null },
  ])('rejects malformed geometry %j in every restore carrier', invalid => {
    const state = makeState(12, 12);
    const saved = JSON.parse(serialize(state));
    saved.objects = [{ ...object, x: 5, y: 5, ...invalid }];
    expect(deserialize(JSON.stringify(saved), state.template).objects.has(object.id)).toBe(false);
    const restored = { ...object, ...invalid, position: { x: 'x' in invalid ? invalid.x : 5, y: 5 } };
    for (const carrier of ['place', 'remove', 'added', 'removed']) {
      expect(decodeHistory(history(restored, carrier), state.template), carrier).toBeNull();
    }
  });

  it.each([undefined, 1, 6, 12])('accepts bounded or absent span %s in both formats', spanLength => {
    const state = makeState(12, 12);
    const saved = JSON.parse(serialize(state));
    saved.objects = [{ ...object, x: 5, y: 5, spanLength }];
    expect(deserialize(JSON.stringify(saved), state.template).objects.get(object.id)?.spanLength).toBe(spanLength);
    expect(deserialize(JSON.stringify(saved), state.template).objects.has(object.id)).toBe(true);
    expect(decodeHistory(history({ ...object, spanLength }, 'place'), state.template)).toHaveLength(1);
  });

  it('reports invalid history separately while preserving imported map content', () => {
    const state = makeState(12, 12);
    state.objects.set(object.id, { ...object, rotation: 0 });
    const before = structuredClone(state);
    let installed = false;
    const result = applyOptionalSections({ history: history({ ...object, spanLength: -1 }, 'removed') }, {
      state, executor: { restoreHistory: () => { installed = true; } },
      setLayerLocked: () => {}, setCamera: () => {},
    });
    expect(result.dropped).toEqual(['history']);
    expect(installed).toBe(false);
    expect(state).toEqual(before);
  });
});

describe('a malformed object entry', () => {
  const entries: unknown[] = [
    null, 0, 7, 'bridge', true, [], [object], {},
    { id: 'bridge' }, { catalogId: 'bridge-plank' }, { ...object, catalogId: 7 }, { ...object, catalogId: null },
    { id: 'bridge', catalogId: 'bridge-plank', x: 5, y: 5 }, { id: 'bridge', catalogId: 'bridge-plank', rotation: 0 },
    { ...object, x: '5', y: 5 }, { ...object, x: 5, y: 5, patchOnly: 'yes' }, { ...object, x: 5, y: 5, corners: 12 },
  ];

  it.each(entries.map((entry) => [JSON.stringify(entry) ?? String(entry), entry]))('%s is skipped while the rest of the map loads', (_label, entry) => {
    const state = makeState(12, 12);
    const saved = JSON.parse(serialize(state));
    saved.objects = [entry, { ...object, id: 'kept', x: 5, y: 5 }];
    const map = deserialize(JSON.stringify(saved), state.template);
    expect([...map.objects.keys()]).toContain('kept');
    expect(map.objects.size).toBe(1);
  });

  const steps: unknown[] = [
    ...entries.slice(0, 12),
    { ...object, position: null }, { ...object, position: { x: '5', y: 5 } }, { ...object, patchOnly: 'yes' }, { ...object, elevation: undefined },
  ];

  it.each(steps.map((entry) => [JSON.stringify(entry) ?? String(entry), entry]))('%s rejects a history step that replays it', (_label, entry) => {
    const state = makeState(12, 12);
    expect(decodeHistory(history(entry, 'place'), state.template)).toBeNull();
  });
});
