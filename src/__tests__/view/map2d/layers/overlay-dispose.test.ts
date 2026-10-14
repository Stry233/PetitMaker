// @vitest-environment jsdom
/**
 * Overlay teardown: dispose cancels every frame the layer scheduled, and calls arriving after the
 * renderer destroyed its Graphics are no-ops.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { cellSet } from '../../../../core/grid/grids';
import { __resetMotionState } from '../../../../platform/channels/motion-state';

describe('OverlayLayer.dispose', () => {
  afterEach(() => { __resetMotionState(); vi.restoreAllMocks(); });

  it('cancels running flashes, the pending ghost, the region pulse and the planet flash', () => {
    let next = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => ++next);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const layer = new OverlayLayer(() => {});
    layer.flashCommit([cellSet('terrain', [{ x: 1, y: 1 }])]);
    layer.showGhost(cellSet('terrain', [{ x: 2, y: 2 }]), { wash: 'placement', valid: true });
    layer.showBuildableRegion(cellSet('terrain', [{ x: 3, y: 3 }]));
    layer.pulseBuildableRegion(400, 0.5);
    layer.showFrame({ x0: 0, y0: 0, cols: 1, rows: 1 });
    layer.flashFrame(900);
    const scheduled = next;
    layer.dispose();
    const cancelled = new Set(cancel.mock.calls.map(([id]) => id));
    for (let id = 1; id <= scheduled; id++) expect(cancelled.has(id), `frame ${id}`).toBe(true);
  });

  it('turns later drawing calls into no-ops once the Graphics are destroyed', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const layer = new OverlayLayer(() => {});
    layer.dispose();
    layer.container.destroy({ children: true });
    expect(() => {
      layer.showHover({ x: 1, y: 1, w: 1, h: 1 }, 'object');
      layer.clearHover();
      layer.clearSelection();
      layer.showBand({ x: 0, y: 0, w: 2, h: 2 });
      layer.clearBand();
      layer.showPath(cellSet('terrain', [{ x: 1, y: 1 }]));
      layer.clearPath();
      layer.clearBuildableRegion();
      layer.showFrame(null);
      layer.clearGhost();
      layer.flashCommit([cellSet('terrain', [{ x: 1, y: 1 }])]);
    }).not.toThrow();
    expect(raf).not.toHaveBeenCalled();
  });
});
