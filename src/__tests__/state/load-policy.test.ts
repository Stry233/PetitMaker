import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../state/store';
import { getMapStats } from '../../state/map-stats';
import { createDefaultRegistry } from '../../rules';
import { makeObject, makeState } from '../rules/_helpers';
import { readPref, removePref } from '../../core/runtime/prefs';
import { cloneGridState, bumpObjectsVersion } from '../../core/model/grid-model';
import { encodeGridState, decodeGridState } from '../../core/model/grid-wire';
import { isChunkLoadEnforced } from '../../core/model/load';
import { CHUNK_LOAD_LIMIT } from '../../core/model/game-profile';
import { catalogLoadValue } from '../../state/catalog';
import { mapFingerprint } from '../../tools/macros';

beforeEach(() => removePref('enforceChunkLoad'));

describe('regional load policy', () => {
  it('opens an overloaded map intact with enforcement off for that map and a pending notice', () => {
    const state = makeState(32, 32);
    const count = Math.floor(CHUNK_LOAD_LIMIT / catalogLoadValue('flower-protea')) + 1;
    for (let i = 0; i < count; i++) {
      const obj = { ...makeObject('flower-protea', i % 12, Math.floor(i / 12)), id: `flower-${i}` };
      state.objects.set(obj.id, obj);
    }
    useEditorStore.getState().loadMap(state, createDefaultRegistry());
    expect(isChunkLoadEnforced(state)).toBe(false);
    expect(readPref('enforceChunkLoad')).toBe(true);
    expect(state.objects.size).toBe(count);
    expect(getMapStats(state).chunks.get('0,0')!.load).toBeGreaterThan(CHUNK_LOAD_LIMIT);
    expect(useEditorStore.getState().loadLimitNotice).toBe(true);
    useEditorStore.getState().dismissLoadLimitNotice();
    expect(useEditorStore.getState().loadLimitNotice).toBe(false);
    useEditorStore.getState().setLoadEnforced(true);
    expect(isChunkLoadEnforced(state)).toBe(true);
    expect(state.objects.size).toBe(count);
  });

  it('enforces the limit on the next map after an overloaded one', () => {
    const state = makeState(32, 32);
    const count = Math.floor(CHUNK_LOAD_LIMIT / catalogLoadValue('flower-protea')) + 1;
    for (let i = 0; i < count; i++) {
      const obj = { ...makeObject('flower-protea', i % 12, Math.floor(i / 12)), id: `flower-${i}` };
      state.objects.set(obj.id, obj);
    }
    useEditorStore.getState().loadMap(state, createDefaultRegistry());
    expect(isChunkLoadEnforced(state)).toBe(false);
    useEditorStore.getState().initMap(state.template, createDefaultRegistry());
    expect(isChunkLoadEnforced(useEditorStore.getState().gridState!)).toBe(true);
    expect(useEditorStore.getState().loadLimitNotice).toBe(false);
  });

  it('retains the preference across maps and copies it into worker and preview states', () => {
    const state = makeState();
    useEditorStore.getState().loadMap(state, createDefaultRegistry());
    const before = mapFingerprint(state);
    expect(isChunkLoadEnforced(state)).toBe(true);
    useEditorStore.getState().setLoadEnforced(false);
    expect(mapFingerprint(state)).not.toBe(before);
    expect(isChunkLoadEnforced(cloneGridState(state))).toBe(false);
    expect(isChunkLoadEnforced(decodeGridState(encodeGridState(state), state.template))).toBe(false);
    const next = makeState();
    useEditorStore.getState().loadMap(next, createDefaultRegistry());
    expect(isChunkLoadEnforced(next)).toBe(false);
    expect(useEditorStore.getState().loadLimitNotice).toBe(false);
  });

  it('tracks unknown entries and removes decimal loads without residue', () => {
    const state = makeState();
    const a = makeObject('tree-bamboo', 2, 2);
    const b = makeObject('shrub', 6, 6);
    state.objects.set(a.id, a);
    state.objects.set(b.id, b);
    const stats = getMapStats(state);
    expect(stats.chunks.get('0,0')).toMatchObject({ load: 599.4, unknownLoads: 1 });
    state.objects.delete(a.id);
    bumpObjectsVersion(state, { removed: [a] });
    expect(getMapStats(state).chunks.get('0,0')).toMatchObject({ load: 0, unknownLoads: 1 });
  });
});
