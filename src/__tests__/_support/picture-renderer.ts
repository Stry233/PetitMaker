/**
 * A stand-in for the live 2D renderer that takes every in-app map picture
 * (`view/map2d/capture/thumbnail.ts`): jsdom draws nothing, so it answers each `captureState` with a
 * blank canvas and keeps what it was asked to draw, the notes the picture would carry included.
 */
import type { AnnotationsState } from '../../core/model/annotations';
import type { GridState } from '../../core/model/types';
import type { DetachedCaptureOptions } from '../../view/map2d/capture/detached-capture';
import type { MapRenderer } from '../../view/map2d/scene/map-renderer';
import { setMapRenderer } from '../../view/map2d/scene/renderer-registry';
import { pictureNotes } from '../../view/shared/annotation/draw-options';

export interface PictureCall { state: GridState; options: DetachedCaptureOptions }

/** Installs the stand-in; `uninstall` takes it away again. */
export function installPictureRenderer(): { calls: PictureCall[]; uninstall: () => void } {
  const calls: PictureCall[] = [];
  setMapRenderer({
    captureState: async (state: GridState, options: DetachedCaptureOptions = {}) => {
      calls.push({ state, options });
      // A canvas in jsdom; outside it, the one call the PNG path makes.
      return globalThis.document?.createElement('canvas') ?? ({ toDataURL: () => 'data:image/png;base64,' } as unknown as HTMLCanvasElement);
    },
  } as unknown as MapRenderer);
  return { calls, uninstall: () => setMapRenderer(null) };
}

/** One note of each kind (zone, chip, route, measure), shown or hidden as `visible` says. */
export function sampleNotes(visible = true): AnnotationsState {
  return {
    visible, locked: false,
    items: [
      { kind: 'zone', id: 'z', cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }], color: '#38BDF8', tag: null, num: 1 },
      { kind: 'chip', id: 'c', x: 4, y: 4, tag: 'custom:t', size: 'm', color: '#38BDF8' },
      { kind: 'route', id: 'r', points: [{ x: 2, y: 6 }, { x: 6, y: 6 }], color: '#38BDF8', dashed: false },
      { kind: 'measure', id: 'm', points: [{ x: 1, y: 8 }, { x: 5, y: 8 }], color: '#38BDF8' },
    ],
    customTags: [{ id: 'custom:t', text: 'Pond' }],
  };
}

/** The notes a picture call draws, read as the detached capture reads them. */
export function drawnNotes(call: PictureCall): AnnotationsState | null {
  return pictureNotes(call.state, call.options.notes);
}
