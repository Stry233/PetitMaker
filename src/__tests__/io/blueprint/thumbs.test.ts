// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blueprintThumbs } from '../../../io/blueprint/thumbs';
import { BLUEPRINT_THUMB_MAX_CHARS } from '../../../io/blueprint/format';
import { TerrainType } from '../../../core/model/types';
import { MAP_LIST } from '../../../config/maps';
import { installPictureRenderer } from '../../_support/picture-renderer';
import { cellsCaptureFrame } from '../../../core/grid/map-chunks';
import { THUMB_ASPECT } from '../../../io/blueprint/facts';
import { cellsBounds } from '../../../core/grid/rect';
import { islandBounds } from '../../../view/map3d/camera/controls';
import { captureMapStills } from '../../../view/map3d/capture/stills';

// Heard, not replaced: every test draws through the real capture.
vi.mock('../../../view/map3d/capture/stills', async (original) => {
  const actual = await original<typeof import('../../../view/map3d/capture/stills')>();
  return { ...actual, captureMapStills: vi.fn(actual.captureMapStills) };
});

const body = {
  w: 4, h: 3,
  cells: Array.from({ length: 12 }, () => ({ type: TerrainType.Mountain, rise: 1 })),
  objects: [],
};
const template = MAP_LIST[0]!;

describe('blueprint thumbnails', () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA'); });
  afterEach(() => vi.restoreAllMocks());

  it('renders the body alone as a data URL, framed on its rectangle', async () => {
    const picture = installPictureRenderer();
    try {
      const { flat } = await blueprintThumbs(body, template);
      expect(flat).toMatch(/^data:image\//);
      expect(flat.length).toBeLessThanOrEqual(BLUEPRINT_THUMB_MAX_CHARS);
      const call = picture.calls[0]!;
      expect(call.state.template).toBe(template);
      expect(call.state.objects.size).toBe(0);
      expect(call.state.cells.flat().filter((c) => c.terrain).length).toBeGreaterThanOrEqual(body.w * body.h);
      const f = call.options.frame!;
      expect(f.width).toBeGreaterThanOrEqual(body.w);
      expect(f.height).toBeGreaterThanOrEqual(body.h);
    } finally { picture.uninstall(); }
  });

  it('frames the flat picture at the card\'s shape once terrain\'s bleed is added, so no sea bars show', async () => {
    const picture = installPictureRenderer();
    try {
      for (const b of [body, { ...body, w: 8, h: 8, cells: Array.from({ length: 64 }, () => null) }]) {
        picture.calls.length = 0;
        await blueprintThumbs(b, template);
        const drawn = cellsCaptureFrame(picture.calls[0]!.options.frame!);
        expect(drawn.width / drawn.height).toBeCloseTo(THUMB_ASPECT, 6);
      }
    } finally { picture.uninstall(); }
  });

  it('aims the lifted picture at the body, which the scene places from its island\'s centre', async () => {
    const picture = installPictureRenderer();
    try {
      await blueprintThumbs(body, template);
      const cells = picture.calls[0]!.state.cells.flatMap((row, y) => row.flatMap((c, x) => (c.terrain ? [{ x, y }] : [])));
      const at = cellsBounds(cells)!;
      const angle = vi.mocked(captureMapStills).mock.calls.at(-1)![1]?.[0];
      if (!angle || !('tx' in angle)) throw new Error('the lifted picture without a framing takes a camera angle');
      const island = islandBounds(template, 0);
      expect(angle.tx! + (island.centerX ?? 0) + template.width / 2).toBeCloseTo(at.x + body.w / 2);
      expect(angle.tz! + (island.centerZ ?? 0) + template.height / 2).toBeCloseTo(at.y + body.h / 2);
    } finally { picture.uninstall(); }
  });

  it('takes each picture through exactly the crop and the camera it is handed, the body laid where it was framed', async () => {
    const picture = installPictureRenderer();
    try {
      const flat = { x: 30, y: 24, width: THUMB_ASPECT * 9, height: 9 };
      const lifted = { az: 120, el: 50, dist: 0.3, tx: 4, tz: -2 };
      await blueprintThumbs(body, template, { at: { x: 33, y: 27 }, flat, lifted });
      const call = picture.calls[0]!;
      const drawn = cellsCaptureFrame(call.options.frame!);
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(drawn[k]).toBeCloseTo(flat[k]);
      expect(call.state.cells[27]![33]!.terrain).toBeTruthy();
      expect(vi.mocked(captureMapStills).mock.calls.at(-1)![1]).toEqual([lifted]);
    } finally { picture.uninstall(); }
  });

  it('leaves a thumbnail empty where its renderer is unavailable', async () => {
    expect(await blueprintThumbs(body, template)).toEqual({ flat: '', lifted: '' });
  });
});
