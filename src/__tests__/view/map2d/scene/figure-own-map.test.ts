// @vitest-environment jsdom
/** A 2D renderer drawing a map that is not the editor's (a Help figure, a detached capture) reads only its own map, never the editor store. */
import '../../../_support/pixi-env';
import * as PIXI from 'pixi.js-legacy';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../view/shared/road/material-texture', () => ({
  roadMaterialTexture: () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    return canvas;
  },
}));
vi.mock('../../../../view/shared/road/surface-image', () => ({
  surfaceImage: () => null,
  surfaceImagesReady: () => Promise.resolve(),
}));
vi.mock('../../../../view/shared/road/tile-texture', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../view/shared/road/tile-texture')>(),
  roadTileReady: () => Promise.resolve(),
}));
import type { PlacedObject } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { rendererLayers } from '../../../_support/renderer-layers';
import { EventBus } from '../../../../core/commands/event-bus';
import { useEditorStore } from '../../../../state/store';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { roadMaterialSettled } from '../../../../view/shared/road/material';

const ROAD = 'path-urban-asphalt';

function figureMap() {
  const state = makeState(20, 20);
  for (let x = 4; x < 8; x++) {
    const road: PlacedObject = { id: `r${x}`, catalogId: ROAD, position: { x, y: 6 }, rotation: 0, elevation: 0 };
    state.objects.set(road.id, road);
  }
  return state;
}

beforeAll(() => roadMaterialSettled());
afterEach(() => { vi.restoreAllMocks(); useEditorStore.setState({ gridState: null }); });

describe('a figure renderer', () => {
  it('draws, animates and captures its own map without reading the editor store', async () => {
    // The editor holds a different map whose ids collide with the figure's.
    const editorMap = makeState(20, 20);
    editorMap.objects.set('r4', { id: 'r4', catalogId: ROAD, position: { x: 15, y: 15 }, rotation: 0, elevation: 0 });
    useEditorStore.setState({ gridState: editorMap });
    const reads = vi.spyOn(useEditorStore, 'getState');

    const state = figureMap();
    const bus = new EventBus<EditorEvents>();
    const renderer = new MapRenderer(bus, document.createElement('div'), 64, 64, { preferCanvas: true });
    vi.spyOn(renderer.app.renderer, 'render').mockImplementation(() => {});
    try {
      renderer.initMap(state, null, false, { labels: false });
      const added: PlacedObject = { id: 'r8', catalogId: ROAD, position: { x: 8, y: 6 }, rotation: 0, elevation: 0 };
      state.objects.set(added.id, added);
      bus.emit('objects-changed', { added: [added] });
      rendererLayers(renderer).objectLayer.flushRoadRegions();

      rendererLayers(renderer).objectLayer.animateGroupRotation({
        pivot: { x: 8.5, y: 6.5 }, sweepDeg: 90,
        members: [{ id: 'r8', from: { x: 8.5, y: 6.5 }, spun: false }],
      });
      const wrapper = (rendererLayers(renderer).objectLayer as unknown as { objectMap: Map<string, PIXI.Container> }).objectMap.get('r8')!;
      const flight = wrapper.children.find((c): c is PIXI.Graphics => c instanceof PIXI.Graphics);
      expect(flight, 'the carried road wears a flight body drawn from the figure map').toBeDefined();
      expect(flight!.position.x).toBe(-8 * TILE_SIZE);
      rendererLayers(renderer).objectLayer.animateRemove('r4');

      const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
      gl.generateTexture = () => ({ destroy: () => {} });
      gl.extract = { canvas: () => document.createElement('canvas') };
      await renderer.captureState(state);

      expect(reads).not.toHaveBeenCalled();
    } finally {
      renderer.destroy();
    }
  });
});
