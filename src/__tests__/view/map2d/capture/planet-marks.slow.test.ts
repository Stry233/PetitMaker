// @vitest-environment jsdom
/**
 * A planet picture's red marks stand on the cells they name: a terrain cell's mark covers the
 * pixels the renderer draws that terrain cell at, half a cell up and left of the placement cell of
 * the same index, and a placement cell's mark the pixels of that placement cell. Read on the repair
 * choice's automatic card and the Change Planet carry card, from a visitor save of an old release.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectImportFile } from '../../../../io/import/file';
import { commitImport } from '../../../../editor/session/import-flow';
import { cancelRepair, repairAutomatically, repairPreviews } from '../../../../editor/session/landmark-repair';
import { newMap } from '../../../../editor/operations';
import { editorPort } from '../../../../editor/session/context';
import { useEditorStore } from '../../../../state/store';
import { transferPreviewOf } from '../../../../tools/generation/run/planet-preview';
import { paintPlanet, type PlanetPaintInput } from '../../../../view/map2d/capture/planet-painter';
import { mapPictureFrame } from '../../../../view/map2d/capture/thumbnail';
import { TILE_SIZE, gridOffsetPx } from '../../../../view/map2d/geometry/world';
import { LOSS_COLOR } from '../../../../view/shared/viewport/view-constants';
import type { GridCellRef } from '../../../../core/grid/grids';

vi.setConfig({ testTimeout: 120_000 });

const SAVES = join(__dirname, '..', '..', '..', 'fixtures', 'saves');
/** Picture px per cell of the stand-in picture. */
const PICTURE_CELL = 8;

interface Call { op: string; args: number[]; fillStyle: unknown; target: HTMLCanvasElement }

function recordCanvases(): Call[] {
  const calls: Call[] = [];
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const target = this;
    const known = contexts.get(target);
    if (known) return known;
    let fillStyle: unknown = '#000';
    const rec = (op: string) => (...args: unknown[]) => {
      calls.push({ op, args: args.filter((a): a is number => typeof a === 'number'), fillStyle, target });
    };
    const ctx = {
      get fillStyle() { return fillStyle; }, set fillStyle(v: unknown) { fillStyle = v; },
      globalAlpha: 1, imageSmoothingEnabled: true,
      setTransform: rec('setTransform'), clearRect: rec('clearRect'), fillRect: rec('fillRect'), drawImage: rec('drawImage'),
    } as unknown as CanvasRenderingContext2D;
    contexts.set(target, ctx);
    return ctx;
  } as unknown as HTMLCanvasElement['getContext']);
  return calls;
}

type Box = [number, number, number, number];
/** The part `[x, y, w, h]` of `image`'s pixels, where `image` is drawn over `dest`. */
const within = (dest: Box, image: HTMLCanvasElement, [x, y, w, h]: Box): Box =>
  [dest[0] + x / image.width * dest[2], dest[1] + y / image.height * dest[3], w / image.width * dest[2], h / image.height * dest[3]];
const close = (a: Box, b: Box) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

/**
 * Paints `input` over a stand-in picture taken as the capture takes it, once, and answers for each
 * marked cell the canvas px box of its mark and of the pixels the renderer draws that cell at.
 */
function marksAndPictures(input: PlanetPaintInput): (cell: GridCellRef) => { mark: Box; picture: Box } {
  const calls = recordCanvases();
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 400 });
  Object.defineProperty(canvas, 'clientHeight', { value: 300 });
  const frame = mapPictureFrame(input.state!, undefined, input.flagged);
  const picture = document.createElement('canvas');
  picture.width = frame.width * PICTURE_CELL;
  picture.height = frame.height * PICTURE_CELL;
  paintPlanet(canvas, input, picture, { tx: 0, ty: 0, scale: 1 }, { margin: 0 });
  const [a, , , d, e, f] = calls.filter((c) => c.target === canvas && c.op === 'setTransform').pop()!.args;
  const toCanvas = ([x, y, w, h]: Box): Box => [a! * x + e!, d! * y + f!, a! * w, d! * h];

  const shown = calls.find((c) => c.target === canvas && c.op === 'drawImage' && c.args[0] === frame.x && c.args[1] === frame.y)!;
  const [fx, fy, fw, fh] = shown.args as Box;
  // The marks: their pixels in the marks' raster, one fill per cell in input order, placed where the
  // painter draws that raster.
  const fills = calls.filter((c) => c.target !== canvas && c.op === 'fillRect' && c.fillStyle === LOSS_COLOR);
  expect(fills).toHaveLength(input.dropped!.length);
  const raster = fills[0]!.target;
  const placed = calls.find((c) => c.target === canvas && c.op === 'drawImage' && c !== shown)!.args as Box;
  vi.restoreAllMocks();
  return (cell) => {
    // Where the renderer draws the cell, in world px (its layers' own offsets), then in picture px,
    // then where the painter places that picture pixel.
    const offset = gridOffsetPx(cell.grid);
    const k = PICTURE_CELL / TILE_SIZE;
    const px: Box = [
      (cell.x * TILE_SIZE + offset.x) * k - frame.x * PICTURE_CELL, (cell.y * TILE_SIZE + offset.y) * k - frame.y * PICTURE_CELL,
      PICTURE_CELL, PICTURE_CELL,
    ];
    const mark = within(placed, raster, fills[input.dropped!.indexOf(cell)]!.args as Box);
    return { mark: toCanvas(mark), picture: toCanvas(within([fx, fy, fw, fh], picture, px)) };
  };
}

afterEach(() => {
  if (useEditorStore.getState().repairSession) cancelRepair();
  vi.restoreAllMocks();
});

async function openSave(file = 'hexia-complex-1.0.51.json.gz') {
  newMap(editorPort, 'hexia');
  const text = gunzipSync(readFileSync(join(SAVES, file))).toString('utf8');
  const blob = new Blob([text], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'hexia.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'hexia.json', file: blob });
  const session = useEditorStore.getState().repairSession;
  if (session?.phase !== 'choose') throw new Error('no repair asked');
  return session;
}

describe('a planet picture\'s red marks', () => {
  it('cover a terrain cell\'s own pixels on the repair\'s automatic card', async () => {
    const session = await openSave();
    const previews = repairPreviews(session.pending, session.report);
    expect(previews.ground.length).toBeGreaterThan(0);
    const input = { template: session.pending.template, state: previews.auto, dropped: previews.ground };
    const at = marksAndPictures(input);
    for (const cell of previews.ground) {
      expect(cell.grid).toBe('terrain');
      const { mark, picture } = at(cell);
      close(mark, picture);
    }
  });

  it('cover terrain and placement cells\' own pixels on the Change Planet carry card', async () => {
    // Hexia's build carried onto the smaller custom planet of another save, where its edges land off.
    await openSave('custom-complex-1.6.1797.json.gz');
    repairAutomatically();
    const custom = useEditorStore.getState().gridState!.template;
    await openSave();
    repairAutomatically();
    const preview = transferPreviewOf(useEditorStore.getState().gridState!, custom);
    const terrain = preview.dropped.find((c) => c.grid === 'terrain');
    const placement = preview.dropped.find((c) => c.grid === 'object');
    expect({ terrain: !!terrain, placement: !!placement, cells: preview.dropped.length }).toMatchObject({ terrain: true, placement: true });
    const input = { template: preview.state.template, state: preview.state, dropped: preview.dropped };
    const at = marksAndPictures(input);
    for (const cell of [terrain!, placement!]) {
      const { mark, picture } = at(cell);
      close(mark, picture);
    }
  });
});
