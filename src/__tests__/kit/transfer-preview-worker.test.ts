/**
 * The carry preview a worker works out is the one the main thread works out.
 *
 * `Worker` does not exist here, so the worker's own entry is loaded as a module with a stand-in
 * `self` and handed a structured clone of the message the pool posts; its answer is cloned and
 * revived exactly the way the pool revives it. Both ends run `transferPreviewOf`, so what this pins is the wire between them:
 * the source map on the way in, the destination and the loss report on the way out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateMap, newMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { getMapTemplate } from '../../config/maps';
import { mapFingerprint } from '../../tools/macros/scratch';
import { reviveTransferPreview, wireGrid, type WireTransferPreview } from '../../kit/operations/candidate-pool';
import { transferPreviewOf, type TransferPreview } from '../../kit/operations/planet-preview';
import { __resetCandidateCache } from '../../kit/operations/generate';
import { createGridState, PLANET_CANVAS_ID_PREFIX } from '../../core/model/planet';
import { CellZone, type GenerateConfig, type GridState, type MapTemplate } from '../../core/model/types';

vi.setConfig({ testTimeout: 60_000 });

const config: GenerateConfig = {
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 8123, region: null,
  richness: 1,
};

/** A small grass planet, so part of a hexia build lands on sea and off the canvas. */
function smallPlanet(): MapTemplate {
  const size = 48;
  const zones = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) =>
    (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 ? CellZone.Void : CellZone.Grass)));
  const at = size / 2 - 1.5;
  return { id: 'custom-worker-small', name: { en: 'small' }, width: size, height: size, zones, plaza: { x: at, y: at, width: 3, height: 3, elevation: 1 } };
}

type Scope = { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: unknown) => void };

let scope: Scope;
let answers: unknown[];

beforeEach(async () => {
  answers = [];
  scope = { onmessage: null, postMessage: (msg) => { answers.push(msg); } };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../../kit/operations/candidate.worker');
});

afterEach(() => { vi.unstubAllGlobals(); });

interface Answer { id: number; ok: boolean; error?: string; preview?: WireTransferPreview }

/** One job through the worker entry, as `post` sends it: each template only when `send` says the
 *  worker has not had it yet. */
async function post(state: GridState, target: MapTemplate, send: { grid: boolean; target: boolean }): Promise<Answer> {
  const id = answers.length + 1;
  const grid = wireGrid(state, send.grid);
  const message = { id, grid, ...(send.target ? { templates: [target] } : {}), kind: 'transfer', targetId: target.id };
  scope.onmessage!({ data: structuredClone(message) } as MessageEvent);
  await vi.waitFor(() => expect(answers).toHaveLength(id));
  return structuredClone(answers[id - 1]) as Answer;
}

/** The answer as the pool revives it. */
function revived(answer: Answer, target: MapTemplate): TransferPreview {
  expect(answer.error).toBeUndefined();
  expect(answer.ok).toBe(true);
  return reviveTransferPreview(answer.preview!, target);
}

function expectSame(worker: TransferPreview, main: TransferPreview): void {
  expect(mapFingerprint(worker.state)).toBe(mapFingerprint(main.state));
  expect([...worker.state.objects.keys()].sort()).toEqual([...main.state.objects.keys()].sort());
  expect(worker.state.template).toBe(main.state.template);
  expect(worker.dropped).toEqual(main.dropped);
  expect(worker.moved).toEqual(main.moved);
  expect(worker.droppedCounts).toEqual(main.droppedCounts);
}

describe('a carry preview worked out in the worker', () => {
  it('matches the main thread onto a built-in and onto a planet that drops part of the build', async () => {
    __resetCandidateCache();
    newMap('hexia');
    const kit = currentKit()!;
    await generateMap(kit, { config, region: null });
    const state = kit.state;

    const tafa = getMapTemplate('tafa');
    expectSame(revived(await post(state, tafa, { grid: true, target: true }), tafa), transferPreviewOf(state, tafa));

    // The worker kept hexia from the first job; the small planet travels once, then by id.
    const small = smallPlanet();
    const main = transferPreviewOf(state, small);
    expect(main.dropped.length).toBeGreaterThan(0);
    expectSame(revived(await post(state, small, { grid: false, target: true }), small), main);
    expectSame(revived(await post(state, small, { grid: false, target: false }), small), main);
  });

  it('keeps only the latest planet editor canvas, so an earlier session\'s canvas is never read again', async () => {
    const canvas = (n: number): MapTemplate => ({ ...smallPlanet(), id: `${PLANET_CANVAS_ID_PREFIX}${n}` });
    const tafa = getMapTemplate('tafa');
    const first = createGridState(canvas(1)), second = createGridState(canvas(2));
    // A grid on the first canvas, then one on the second: the worker now knows the second alone.
    expect((await post(first, tafa, { grid: true, target: true })).ok).toBe(true);
    expect((await post(second, tafa, { grid: true, target: false })).ok).toBe(true);
    expect((await post(first, tafa, { grid: false, target: false })).error).toMatch(/unknown template planet-canvas-1/);
    expect((await post(second, tafa, { grid: false, target: false })).ok).toBe(true);
  });

  it('refuses a destination it was never sent', async () => {
    newMap('hexia');
    const answer = await post(currentKit()!.state, smallPlanet(), { grid: true, target: false });
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatch(/unknown template/);
  });
});
