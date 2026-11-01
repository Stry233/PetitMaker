/** Maps that come from elsewhere: withdrawn items, share codes that cannot hold everything, codes
 *  carrying a generation recipe, and the author's notes on an imported hand-made map. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { CURRENT_VERSION } from '../../../io/save/format';
import { buildShareCode } from '../../../io/share';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem, getOfferedItem } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { createExecutor } from '../../../state/executor';
import { attributedNotes, attributionUnits } from '../../../state/notes-attribution';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { detachedContext } from '../../../tools/macros';
import type { MacroCoord } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { exportable } from '../../_support/exportable';
import { resetStore } from '../../_support/store';
import { TerrainType, rect, world } from '../_world';
import { generate, freshPage, mapValue, maze, ruleFindings } from '../generation/_generation';
import { builtMap, exportJson, importCode, preview, seen, shareCode } from './_files';

const WITHDRAWN = 'print-flight-jump-2';

describe('a withdrawn item', () => {
  spec('FILE-15', 'still opens from a map file and a share code on a map that holds it, though no list offers it', async () => {
    expect(getCatalogItem(WITHDRAWN)).toBeDefined();
    expect(getOfferedItem(WITHDRAWN)).toBeUndefined();
    const w = builtMap();
    const at = w.openGround(3, 3);
    const obj = candidateObject(getCatalogItem(WITHDRAWN)!, { x: at.x + 1, y: at.y + 1 }, 0, w.state, { id: 'print' });
    expect(w.sandbox.execute(placeObjectCommand(obj)).success).toBe(true);

    const fromFile = (await preview(exportJson(w.state))).preview;
    expect(fromFile.state.objects.get('print')?.catalogId).toBe(WITHDRAWN);
    expect(seen(fromFile.state)).toBe(seen(w.state));
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect([...result.state.objects.values()].filter((o) => o.catalogId === WITHDRAWN)).toHaveLength(1);
    expect(seen(result.state)).toBe(seen(w.state));
    // Drawing reads the item's own print, which the catalog still holds.
    expect(getCatalogItem(WITHDRAWN)!.surfacePrint).toBeDefined();
  });
});

describe('a share code that cannot hold everything', () => {
  spec('FILE-24', 'an image size too narrow for any code gets no code, while the same map at the Standard width gets one', async () => {
    const state = exportable(builtMap().state);
    const meta = { appVersion: 'spec', saveVersion: CURRENT_VERSION };
    expect(await buildShareCode(state, null, meta, 120)).toBeNull();
    expect(await buildShareCode(state, null, meta, 1600)).not.toBeNull();
  });
});

describe('a share code of a generated map', () => {
  spec('GEN-04', 'carries the seed and settings of a whole-planet run, from which the same planet is built again', async () => {
    freshPage();
    const w = world();
    const config = maze(41);
    await generate(w, config);
    expect(w.state.generation).toMatchObject({ seed: 41, maxElevation: 2 });
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.generation).toEqual(w.state.generation);
    freshPage();
    const again = world();
    await generate(again, result.state.generation as typeof config);
    expect(mapValue(again.state)).toBe(mapValue(w.state));
  });

  spec('GEN-04', 'carries no recipe after a region-scoped run or once the run is undone', async () => {
    freshPage();
    const scoped = world();
    const at = scoped.openGround(12, 12);
    await generate(scoped, maze(42), rect(at, 12, 12));
    const fromScoped = await importCode(await shareCode(scoped.state));
    if (!fromScoped.ok) throw new Error(fromScoped.error.code);
    expect(fromScoped.state.generation).toBeUndefined();

    freshPage();
    const undone = world();
    await generate(undone, maze(43));
    undone.undo();
    const fromUndone = await importCode(await shareCode(undone.state));
    if (!fromUndone.ok) throw new Error(fromUndone.error.code);
    expect(fromUndone.state.generation).toBeUndefined();
  });

  spec('FILE-26', 'imports as shared, hand edits after the run included, rather than as the recipe would build it', async () => {
    freshPage();
    const w = world();
    await generate(w, maze(44));
    const built = mapValue(w.state);
    const at = w.openGround(1, 1, 0);
    expect(w.stroke([at], TerrainType.Mountain, 1).ok).toBe(true);
    expect(mapValue(w.state)).not.toBe(built);
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.generation, 'the recipe rides along as a note').toMatchObject({ seed: 44 });
    expect(seen(result.state)).toBe(seen(w.state));
    expect(ruleFindings(w), 'the map opened is legal').toEqual([]);
    expect(ruleFindings(detachedContext(result.state, createDefaultRegistry()))).toEqual([]);
    const opened = createExecutor(result.state, createDefaultRegistry());
    expect(opened.canUndo(), 'a share code carries no history').toBe(false);
  });
});

describe('an imported hand-made map\'s notes', () => {
  spec('FILE-27', 'keep the author\'s title and description until thirty percent of the map changed, and lock again on undo', async () => {
    resetStore();
    const w = world();
    const at = w.openGround(18, 18);
    expect(w.stroke(rect(at, 18, 18), TerrainType.Mountain, 1).ok).toBe(true);
    w.state.notes = { title: 'Hill garden', description: 'A square hill' };
    const result = await importCode(await shareCode(w.state));
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.notes).toEqual({ title: 'Hill garden', description: 'A square hill' });
    const opened = new SandboxWorld(undefined, { base: result.state });
    useEditorStore.setState({ gridState: opened.state, commandExecutor: opened.executor });
    const rename = () => useEditorStore.getState().setMapNotes({ title: 'My garden', description: 'Mine now' });
    const authors = { title: 'Hill garden', description: 'A square hill' };
    /** Raise `cells` of the hill to layer 2 in one stroke. */
    const raise = (cells: MacroCoord[]) => {
      opened.beginStroke();
      opened.paint(cells, TerrainType.Mountain, 2);
      expect(opened.commit()).toEqual([]);
    };
    // The map's content is counted as one unit per terrain cell and unlocked object, the planet's own
    // mountains included; thirty percent of it is the share the importer must change.
    const units = attributionUnits(opened.state).length;
    const threshold = Math.ceil(units * 0.3);
    const ground = rect(at, 18, 18);
    expect(threshold).toBeLessThan(ground.length);

    rename();
    expect(opened.state.notes, 'nothing changed yet').toEqual(authors);
    raise(ground.slice(0, threshold - 1));
    rename();
    expect(opened.state.notes, 'just under thirty percent changed').toEqual(authors);
    raise(ground.slice(threshold - 1, threshold));
    rename();
    expect(opened.state.notes, 'thirty percent changed').toEqual({ title: 'My garden', description: 'Mine now' });
    opened.undo();
    rename();
    expect(attributedNotes(opened.state), 'the change undone locks them again').toEqual(authors);
  });
});
