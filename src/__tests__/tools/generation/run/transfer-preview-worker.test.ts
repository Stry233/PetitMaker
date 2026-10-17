/**
 * The carry preview a worker works out is the one the main thread works out.
 *
 * `Worker` does not exist here, so the worker's own entry is loaded as a module with a stand-in
 * `self` and handed a structured clone of the message the pool posts; its answer is cloned and
 * revived exactly the way the pool revives it. Both ends run `transferPreviewOf`, so what this pins is the wire between them:
 * the source map and its plan notes on the way in, the destination, its notes and the loss report on the way out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateMap, newMap } from '../../../../editor/operations';
import { currentEditor, editorPort } from '../../../../editor/session/context';
import { getMapTemplate } from '../../../../config/maps';
import { mapFingerprint } from '../../../../core/model/fingerprint';
import { reviveTransferPreview, wireGrid, type WireTransferPreview } from '../../../../tools/generation/run/candidate-wire';
import { transferPreviewOf, type TransferPreview } from '../../../../tools/generation/run/planet-preview';
import { __resetCandidateCache } from '../../../../tools/generation/run/candidates';
import { createGridState } from '../../../../core/model/template';
import { PLANET_CANVAS_ID_PREFIX } from '../../../../tools/generation/run/planet-canvas';
import { type GridState, type MapTemplate } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { CellZone } from '../../../../core/game/zones';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { annotationsOf } from '../../../../core/model/annotations';
import { DEFAULT_TAG } from '../../../../config/annotation-tags';

vi.setConfig({ testTimeout: 60_000 });

const config: GenerateConfig = defaultConfig('designed', { maxElevation: 6, seed: 8123, richness: 1 });

/** A small grass planet, so part of a hexia build lands on sea and off the canvas. */
function smallPlanet(): MapTemplate {
  const size = 48;
  const zones = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) =>
    (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 ? CellZone.Void : CellZone.Grass)));
  const at = size / 2 - 1.5;
  return { id: 'custom-worker-small', name: { en: 'small' }, width: size, height: size, zones, landmarks: [{ id: ANCHOR_LANDMARK.id, x: at, y: at, width: 3, height: 3 }]};
}

type Scope = { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: unknown) => void };

let scope: Scope;
let answers: unknown[];

beforeEach(async () => {
  answers = [];
  scope = { onmessage: null, postMessage: (msg) => { answers.push(msg); } };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  await import('../../../../tools/generation/run/candidate.worker');
});

afterEach(() => { vi.unstubAllGlobals(); });

interface Answer { id: number; ok: boolean; error?: string; preview?: WireTransferPreview }

/** One job through the worker entry, as `post` sends it: each template only when `send` says the
 *  worker has not had it yet. */
async function post(state: GridState, target: MapTemplate, send: { grid: boolean; target: boolean }): Promise<Answer> {
  const id = answers.length + 1;
  const grid = wireGrid(state, send.grid);
  // The plan notes ride beside the grid, as the pool sends them.
  const notes = state.annotations ? { annotations: state.annotations } : {};
  const message = { id, grid, ...(send.target ? { templates: [target] } : {}), kind: 'transfer', targetId: target.id, ...notes };
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
  expect(worker.state.annotations).toEqual(main.state.annotations);
}

describe('a carry preview worked out in the worker', () => {
  it('matches the main thread onto a built-in and onto a planet that drops part of the build', async () => {
    __resetCandidateCache();
    newMap(editorPort, 'hexia');
    const kit = currentEditor()!;
    await generateMap(kit, { config, region: null });
    const state = kit.state;
    // A note near each corner, so the small planet leaves some behind and keeps the middle one.
    const w = state.template.width, h = state.template.height;
    annotationsOf(state).items = [[1.5, 1.5], [w - 1.5, h - 1.5], [w / 2, h / 2]].map(([x, y], i) => (
      { kind: 'chip', id: `chip-${i}`, x: x!, y: y!, tag: DEFAULT_TAG, size: 'm', color: '#ff0000' }));

    const tafa = getMapTemplate('tafa');
    expectSame(revived(await post(state, tafa, { grid: true, target: true }), tafa), transferPreviewOf(state, tafa));

    // The worker kept hexia from the first job; the small planet travels once, then by id.
    const small = smallPlanet();
    const main = transferPreviewOf(state, small);
    expect(main.dropped.length).toBeGreaterThan(0);
    expect(main.state.annotations!.items.map((n) => n.id)).toEqual(['chip-2']);
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
    newMap(editorPort, 'hexia');
    const answer = await post(currentEditor()!.state, smallPlanet(), { grid: true, target: false });
    expect(answer.ok).toBe(false);
    expect(answer.error).toMatch(/unknown template/);
  });
});
