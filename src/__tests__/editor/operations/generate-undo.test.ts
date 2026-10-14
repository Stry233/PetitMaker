/**
 * The map's generation record and scope belong to the stroke that wrote them: undoing a Generate
 * takes its recipe and region back with its terrain, undoing a Clear gives them back, and redo
 * restores each again. A JSON export and a share code therefore name a generation only while the
 * map still holds it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearGenerated, generateMap } from '../../../editor/operations';
import { currentEditor } from '../../../editor/session/context';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { getMapTemplate } from '../../../config/maps';
import { getCell } from '../../../core/model/grid-model';
import { isBuildableZone } from '../../../core/game/zones';
import { carrying, serializeWithSections } from '../../../io/save/sections';
import { exportableState } from '../../../io/export/exportable';
import { planetNaming } from '../../../editor/session/planet-names';
import { encodeHistory } from '../../../io/save/history-codec';
import { decodeMapPayload, encodeMapPayload } from '../../../io/share/codec/payload';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';

const config = (seed: number): GenerateConfig => (defaultConfig('maze', { maxElevation: 2, seed }));

const kit = () => currentEditor()!;

/** The generation section the export modal writes when the map has one. */
function exportedGeneration(state: GridState): unknown {
  const json = serializeWithSections(exportableState(state, planetNaming('en')), {
    carry: { ...carrying('annotations', 'notes'), generation: !!state.generation }, pretty: false,
  });
  return (JSON.parse(json) as { generation?: unknown }).generation;
}

async function sharedGeneration(state: GridState): Promise<unknown> {
  const decoded = await decodeMapPayload(await encodeMapPayload(state, null, { appVersion: 'test', saveVersion: 1 }));
  return decoded.generation;
}

/** A small square of buildable cells away from the plaza. */
function region(state: GridState): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = 30; y < 36; y++) for (let x = 20; x < 26; x++) {
    const c = getCell(state.cells, x, y);
    if (c && isBuildableZone(c.zone)) out.push({ x, y });
  }
  return out;
}

describe('the generation record follows undo and redo', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
  });

  it('an undone Generate leaves no recipe in the export or the share code, and redo puts it back', async () => {
    await generateMap(kit(), { config: config(11), region: null });
    const recipe = kit().state.generation;
    expect(recipe?.seed).toBe(11);
    expect(exportedGeneration(kit().state)).toEqual(recipe);
    expect(await sharedGeneration(kit().state)).toEqual(recipe);

    kit().executor.undo();
    expect(kit().state.generation).toBeUndefined();
    expect(exportedGeneration(kit().state)).toBeUndefined();
    expect(await sharedGeneration(kit().state)).toBeUndefined();

    kit().executor.redo();
    expect(kit().state.generation).toEqual(recipe);
    expect(await sharedGeneration(kit().state)).toEqual(recipe);
  }, 60000);

  it('an undone Generate gives back the recipe it replaced', async () => {
    await generateMap(kit(), { config: config(11), region: null });
    const first = kit().state.generation;
    await generateMap(kit(), { config: config(12), region: null });
    expect(kit().state.generation?.seed).toBe(12);

    kit().executor.undo();
    expect(kit().state.generation).toEqual(first);
  }, 60000);

  it('an undone Clear gives the recipe back, and redo drops it again', async () => {
    await generateMap(kit(), { config: config(11), region: null });
    const recipe = kit().state.generation;
    clearGenerated(kit(), { region: null });
    expect(kit().state.generation).toBeUndefined();

    kit().executor.undo();
    expect(kit().state.generation).toEqual(recipe);
    expect(exportedGeneration(kit().state)).toEqual(recipe);

    kit().executor.redo();
    expect(kit().state.generation).toBeUndefined();
  }, 60000);

  it('an undone scoped Generate gives Clear back the scope before it', async () => {
    const scope = region(kit().state);
    await generateMap(kit(), { config: config(11), region: scope });
    await generateMap(kit(), { config: config(12), region: null });
    kit().executor.undo();
    expect(clearGenerated(kit(), { region: null }).cells, 'the scoped run is the last one again').toEqual(scope);
    kit().executor.undo();
    kit().executor.undo();
    expect(clearGenerated(kit(), { region: null }).cells, 'nothing generated before it had a scope').toEqual([]);
  }, 60000);

  it('a saved history carries no generation marks', async () => {
    await generateMap(kit(), { config: config(11), region: null });
    const entries = kit().executor.getUndoEntries();
    const encoded = JSON.parse(JSON.stringify(encodeHistory(entries, 'all'))) as { entries: Record<string, unknown>[] };
    expect(encoded.entries.every((e) => Object.keys(e).every((k) => ['cmd', 'before', 'after', 'objectOps', 'taint'].includes(k)))).toBe(true);
  }, 60000);
});
