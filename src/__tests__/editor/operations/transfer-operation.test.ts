/**
 * Changing planet with the build aboard.
 *
 * The transfer claims to work for any planet with no per-planet code, so the two real templates are
 * tested both ways and a pair of synthetic ones (a different size with a moved plaza) stands in for
 * the planet that does not exist yet. Everything the outcome reports is re-derived here from the two
 * maps, because a report that counted its own refusals would agree with itself and not with the map.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newMap, generateMap, transferMap } from '../../../editor/operations';
import { anchorOffset } from '../../../tools/generation/transfer';
import { currentEditor, editorPort } from '../../../editor/session/context';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { getCell } from '../../../core/model/grid-model';
import { templateAnchor, landmarkObjects } from '../../../core/model/landmarks';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { CommandType, TerrainType } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import type { GridState, MacroCoord, MapTemplate } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { ANCHOR_LANDMARK } from '../../_support/anchor';

const config = (seed: number): GenerateConfig => (defaultConfig('designed', { maxElevation: 4, seed, richness: 1 }));

/** The terrain cells `state`'s landmarks rest on, which a transfer leaves behind with them. */
function underLandmarks(state: GridState): Set<string> {
  return new Set(landmarkObjects(state).flatMap((o) => terrainCellsUnder({ x: o.position.x, y: o.position.y, w: o.width ?? 0, h: o.height ?? 0 })).map((c) => `${c.x},${c.y}`));
}

/** The same counting the operation does, written again from the outside: every source cell that
 *  holds terrain outside its landmarks' ground, against the cell it would land on. */
function diffOf(source: GridState, dest: GridState, offset: MacroCoord): {
  moved: { cells: number; objects: number };
  dropped: { cells: number; objects: number };
} {
  let movedCells = 0, droppedCells = 0;
  const behind = underLandmarks(source);
  for (let y = 0; y < source.template.height; y++) {
    for (let x = 0; x < source.template.width; x++) {
      if (!source.cells[y]?.[x]?.terrain || behind.has(`${x},${y}`)) continue;
      if (getCell(dest.cells, x + offset.x, y + offset.y)?.terrain) movedCells++;
      else droppedCells++;
    }
  }
  let movedObjects = 0, droppedObjects = 0;
  for (const o of source.objects.values()) {
    if (o.locked) continue;
    if (dest.objects.has(o.id)) movedObjects++;
    else droppedObjects++;
  }
  return {
    moved: { cells: movedCells, objects: movedObjects },
    dropped: { cells: droppedCells, objects: droppedObjects },
  };
}

const keepRate = (moved: number, dropped: number): number =>
  moved + dropped === 0 ? 1 : moved / (moved + dropped);

const rules = createDefaultRegistry();

/** Whether the destination would take terrain at this cell at all — asked of the rules here, the
 *  same way the operation asks them, so "buildable ground" is the map's answer and not this test's
 *  idea of a coastline. */
function takesTerrain(dest: GridState, x: number, y: number): boolean {
  const cell = getCell(dest.cells, x, y);
  if (!cell) return false;
  return rules.validatePreCommand({
    type: CommandType.PaintTerrain,     cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
  }, dest).length === 0;
}

beforeEach(() => newMap(editorPort, 'hexia'));

describe('the plaza is what the two planets are laid over each other by', () => {
  it('measures the built-in pair at (0, 0), where both lay the plaza', () => {
    const hexia = getMapTemplate('hexia');
    const tafa = getMapTemplate('tafa');
    expect(anchorOffset(hexia, tafa)).toEqual({ x: 0, y: 0 });
    expect(anchorOffset(tafa, hexia)).toEqual({ x: 0, y: 0 });
  });

  it('anchors a planet whose plaza lays no footprint at its middle', () => {
    const hexia = getMapTemplate('hexia');
    const bare = (plaza: MapTemplate['landmarks'][number] | null): MapTemplate => ({ ...hexia, landmarks: plaza ? [plaza] : [] });
    const middle = bare(null);
    for (const plaza of [{ id: ANCHOR_LANDMARK.id, x: 4, y: 4, width: -2, height: 6 }, { id: ANCHOR_LANDMARK.id, x: 4, y: 4, width: 6, height: -2 }]) {
      expect(anchorOffset(bare(plaza), hexia)).toEqual(anchorOffset(middle, hexia));
    }
  });

  it('is zero between a planet and itself', () => {
    const hexia = getMapTemplate('hexia');
    expect(anchorOffset(hexia, hexia)).toEqual({ x: 0, y: 0 });
  });
});

describe('transfer between the built-in planets', () => {
  for (const [from, to] of [['hexia', 'tafa'], ['tafa', 'hexia']] as const) {
    it(`carries the build from ${from} to ${to} and reports what the map shows`, async () => {
      newMap(editorPort, from);
      await generateMap(currentEditor()!, { config: config(4242), region: null });
      const source = currentEditor()!.state;
      const behind = underLandmarks(source);
      const sourceCells = source.cells.flatMap((row, y) => row.filter((c, x) => c.terrain && !behind.has(`${x},${y}`))).length;
      const sourceObjects = [...source.objects.values()].filter((o) => !o.locked).length;
      expect(sourceCells, 'the generator built something to carry').toBeGreaterThan(1000);
      expect(sourceObjects, 'and decorated it').toBeGreaterThan(100);

      const outcome = transferMap(editorPort, currentEditor()!, { target: to });
      const dest = currentEditor()!.state;

      expect(dest.template.id).toBe(to);
      expect(outcome.target.id).toBe(to);
      expect(outcome.carried).toBe(true);
      expect(outcome.offset).toEqual(anchorOffset(source.template, dest.template));

      // The report is the state diff, not a tally of refusals.
      const diff = diffOf(source, dest, outcome.offset);
      expect({ moved: outcome.moved, dropped: outcome.dropped }).toEqual(diff);
      expect(outcome.moved.cells + outcome.dropped.cells).toBe(sourceCells);
      expect(outcome.moved.objects + outcome.dropped.objects).toBe(sourceObjects);

      // The floor that is the transfer's own: of everything landing on ground the destination will
      // take at all, essentially all of it arrives (measured 99.96% hexia→tafa, 99.8% tafa→hexia;
      // the remainder is Γ fillets whose wrapping context did not survive the move).
      let onGround = 0, lostOnGround = 0;
      for (let y = 0; y < source.template.height; y++) {
        for (let x = 0; x < source.template.width; x++) {
          if (!source.cells[y]?.[x]?.terrain) continue;
          if (!takesTerrain(dest, x + outcome.offset.x, y + outcome.offset.y)) continue;
          onGround++;
          if (!getCell(dest.cells, x + outcome.offset.x, y + outcome.offset.y)?.terrain) lostOnGround++;
        }
      }
      expect(keepRate(onGround - lostOnGround, lostOnGround)).toBeGreaterThanOrEqual(0.99);

      // The floor over the whole build, coast included: the rest of the loss is the destination's
      // own shore refusing a block that would bleed onto it, which no transfer can carry
      // (measured 98.4% hexia→tafa, 97.7% tafa→hexia; objects 98.8% and 99.4%).
      expect(keepRate(outcome.moved.cells, outcome.dropped.cells)).toBeGreaterThanOrEqual(0.97);
      expect(keepRate(outcome.moved.objects, outcome.dropped.objects)).toBeGreaterThanOrEqual(0.98);

      // The arriving map is rule-valid.
      expect(outcome.violations).toEqual([]);
      expect(rules.validatePostStroke(dest)).toEqual([]);
    }, 60_000);
  }

  it('gives the destination its OWN plaza, not the one it was carrying', async () => {
    await generateMap(currentEditor()!, { config: config(7), region: null });
    transferMap(editorPort, currentEditor()!, { target: 'tafa' });

    const dest = currentEditor()!.state;
    const plazas = [...dest.objects.values()].filter((o) => o.catalogId === ANCHOR_LANDMARK.id);
    expect(plazas).toHaveLength(1);
    const tafa = getMapTemplate('tafa');
    expect(plazas[0]!.position).toEqual({ x: templateAnchor(tafa)!.x, y: templateAnchor(tafa)!.y });
    expect(plazas[0]!.width).toBe(templateAnchor(tafa)!.width);
    expect(plazas[0]!.height).toBe(templateAnchor(tafa)!.height);
  }, 60_000);

  it('opens the destination on a fresh history: a transfer is not undoable', async () => {
    await generateMap(currentEditor()!, { config: config(11), region: null });
    transferMap(editorPort, currentEditor()!, { target: 'tafa' });
    expect(currentEditor()!.executor.historyDepth()).toBe(0);
  }, 60_000);

  it('is deterministic: the same build on the same planet arrives the same way twice', async () => {
    await generateMap(currentEditor()!, { config: config(99), region: null });
    const first = transferMap(editorPort, currentEditor()!, { target: 'tafa' });
    const firstMap = mapFingerprint(currentEditor()!.state);

    newMap(editorPort, 'hexia');
    await generateMap(currentEditor()!, { config: config(99), region: null });
    const second = transferMap(editorPort, currentEditor()!, { target: 'tafa' });

    expect(second).toEqual(first);
    expect(mapFingerprint(currentEditor()!.state)).toBe(firstMap);
  }, 120_000);
});

describe('starting fresh instead', () => {
  it('is the plain new-map path, down to the map', async () => {
    await generateMap(currentEditor()!, { config: config(5), region: null });
    const outcome = transferMap(editorPort, currentEditor()!, { target: 'tafa', carry: false });
    const started = mapFingerprint(currentEditor()!.state);

    expect(outcome.carried).toBe(false);
    expect(outcome.moved).toEqual({ cells: 0, objects: 0 });
    expect(outcome.dropped).toEqual({ cells: 0, objects: 0 });

    newMap(editorPort, 'tafa');
    expect(mapFingerprint(currentEditor()!.state)).toBe(started);
  }, 60_000);

  it('is what carrying an empty map amounts to as well', () => {
    const carried = transferMap(editorPort, currentEditor()!, { target: 'tafa' });
    const arrived = mapFingerprint(currentEditor()!.state);

    expect(carried.moved).toEqual({ cells: 0, objects: 0 });
    expect(carried.dropped).toEqual({ cells: 0, objects: 0 });

    newMap(editorPort, 'tafa');
    expect(mapFingerprint(currentEditor()!.state)).toBe(arrived);
  });
});

// ── a planet that does not exist yet ─────────────────────────────────────────────────────────────

/** A small template: grass everywhere but a two-cell void rim, and a plaza wherever it is asked
 *  for. Two of these are as different as two planets get — another size, another coastline, another
 *  plaza — and no code in the transfer knows any of it. */
function tinyPlanet(id: string, width: number, height: number, plazaX: number, plazaY: number): MapTemplate {
  const zones: CellZone[][] = [];
  for (let y = 0; y < height; y++) {
    const row: CellZone[] = [];
    for (let x = 0; x < width; x++) {
      const rim = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      row.push(rim ? CellZone.Void : CellZone.Grass);
    }
    zones.push(row);
  }
  return {
    id, name: { en: id }, width, height, zones,
    landmarks: [{ id: ANCHOR_LANDMARK.id, x: plazaX, y: plazaY, width: 3, height: 3, color: '#E2E8F0' }],
  };
}

/** Raise the named cells a tier and stand a tree on each named spot, through the live rules. */
function build(at: MacroCoord[], trees: MacroCoord[]): void {
  const kit = currentEditor()!;
  const watermark = kit.executor.beginStroke();
  kit.executor.execute({
    type: CommandType.PaintTerrain, cells: at,
    terrainType: TerrainType.Mountain, elevation: 1,
  });
  for (const t of trees) {
    kit.executor.execute({
      type: CommandType.PlaceObject,       object: { id: `tree-${t.x}-${t.y}`, catalogId: 'tree-apple', position: { ...t }, rotation: 0, elevation: 0 },
    });
  }
  watermark.commit();
}

describe('a planet the code has never seen', () => {
  it('carries a build between two synthetic templates, plaza-anchored', () => {
    const a = tinyPlanet('tiny-a', 20, 16, 8.5, 6.5);
    const b = tinyPlanet('tiny-b', 24, 20, 10.5, 5.5);
    // (10.5 + 1.5) − (8.5 + 1.5) = 2 across; (5.5 + 1.5) − (6.5 + 1.5) = −1 up.
    expect(anchorOffset(a, b)).toEqual({ x: 2, y: -1 });

    newMap(editorPort, a);
    const inside: MacroCoord[] = [{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }];
    const trees: MacroCoord[] = [{ x: 7, y: 8 }, { x: 7, y: 12 }];
    build(inside, trees);
    const source = currentEditor()!.state;
    expect(source.cells.flat().filter((c) => c.terrain)).toHaveLength(inside.length);

    const outcome = transferMap(editorPort, currentEditor()!, { target: b });
    const dest = currentEditor()!.state;

    expect(dest.template.id).toBe('tiny-b');
    expect(outcome.offset).toEqual({ x: 2, y: -1 });
    expect(outcome.moved).toEqual({ cells: inside.length, objects: trees.length });
    expect(outcome.dropped).toEqual({ cells: 0, objects: 0 });
    expect({ moved: outcome.moved, dropped: outcome.dropped }).toEqual(diffOf(source, dest, outcome.offset));

    for (const c of inside) {
      expect(getCell(dest.cells, c.x + 2, c.y - 1)?.terrain?.elevation, `${c.x},${c.y} arrived`).toBe(1);
    }
    for (const t of trees) {
      expect(dest.objects.get(`tree-${t.x}-${t.y}`)!.position).toEqual({ x: t.x + 2, y: t.y - 1 });
    }
    // The destination's own plaza, at its own template's position.
    expect(dest.objects.get(ANCHOR_LANDMARK.id)!.position).toEqual({ x: 10.5, y: 5.5 });
  });

  it('counts what the new coast will not take', () => {
    const a = tinyPlanet('tiny-a', 20, 16, 8.5, 6.5);
    // A narrower planet with its plaza in the same place relative to its own middle: the build
    // slides three cells left with the plaza, and what was near the wide planet's right edge falls
    // off the narrow one.
    const narrow = tinyPlanet('tiny-narrow', 14, 16, 5.5, 6.5);
    expect(anchorOffset(a, narrow)).toEqual({ x: -3, y: 0 });

    newMap(editorPort, a);
    const kept: MacroCoord[] = [{ x: 6, y: 6 }, { x: 7, y: 6 }];
    const lost: MacroCoord[] = [{ x: 16, y: 6 }, { x: 17, y: 6 }];   // past the narrow planet's rim
    build([...kept, ...lost], []);
    const source = currentEditor()!.state;

    const outcome = transferMap(editorPort, currentEditor()!, { target: narrow });
    const dest = currentEditor()!.state;

    expect(outcome.moved.cells).toBe(kept.length);
    expect(outcome.dropped.cells).toBe(lost.length);
    expect({ moved: outcome.moved, dropped: outcome.dropped }).toEqual(diffOf(source, dest, outcome.offset));
    for (const c of kept) expect(getCell(dest.cells, c.x - 3, c.y)?.terrain?.elevation).toBe(1);
  });
});

describe('provenance moves with the work', () => {
  it('a generated map stays disclosed as procedural after changing planet', async () => {
    newMap(editorPort, 'hexia');
    await generateMap(currentEditor()!, { config: config(99), region: null });
    const source = currentEditor()!.state;
    const beforeSummary = currentEditor()!.executor.getProvenanceSummary();
    expect(beforeSummary.containsProcedural).toBe(true);
    // A generated object to follow across: pick one and remember its author.
    const someId = [...source.objects.values()].find((o) => !o.locked)!.id;
    const beforeAuthor = currentEditor()!.executor.getAuthorship().objectAuthor(someId);

    const outcome = transferMap(editorPort, currentEditor()!, { target: 'tafa' });
    expect(outcome.carried).toBe(true);
    const kit = currentEditor()!;
    const after = kit.executor.getProvenanceSummary();
    expect(after.containsProcedural).toBe(true);
    // The carried object keeps its author instead of arriving as "imported".
    if (kit.state.objects.has(someId)) {
      expect(kit.executor.getAuthorship().objectAuthor(someId)).toBe(beforeAuthor);
    }
    // Cell taint arrived shifted with the ground: some carried cell reports a procedural author.
    const t = kit.state.provenance!;
    const anyProcedural = t.cellTaint.some((row) => row.some((c) => c !== null && c.contribution.procedural > 0.5));
    expect(anyProcedural).toBe(true);
  });
});

