// @vitest-environment jsdom
/**
 * MapRenderer's own gated tick is the only thing that draws, and only inside a requested window.
 *
 * Pixi's TickerPlugin registers `app.render` on the application ticker when the Application is
 * constructed; `autoStart` gates only whether the ticker is started, so starting it for
 * `renderTick` would run pixi's ungated whole-scene render beside the gated one.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { rendererLayers } from '../../../_support/renderer-layers';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { timedBeat } from '../../../../view/shared/viewport/frame-loop';

const renderers: MapRenderer[] = [];

function makeRenderer(): MapRenderer {
  const r = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 200, 200);
  renderers.push(r);
  return r;
}

afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  vi.useRealTimers();
});

describe('render-on-demand loop', () => {
  it('paints a resized buffer with the new camera before returning to the compositor', () => {
    const r = makeRenderer();
    r.viewport.fitToMap(24, 24);
    const centre = r.viewport.worldAtCentre();
    const draw = vi.spyOn(r.app.renderer, 'render').mockImplementation(() => {
      expect(r.app.renderer.screen.width).toBe(160);
      expect(r.app.renderer.screen.height).toBe(180);
      expect(r.viewport.worldAtCentre()).toEqual(centre);
      const drawn = rendererLayers(r).worldContainer.toGlobal(centre);
      expect(drawn.x).toBeCloseTo(80, 6);
      expect(drawn.y).toBeCloseTo(90, 6);
    });
    const painted = vi.fn();
    r.onNextPaint(painted);
    r.resize(160, 180);
    expect(draw).toHaveBeenCalledOnce();
    expect(painted).toHaveBeenCalledOnce();
  });

  it('does not paint a hidden view for a resize unless a capture is waiting', () => {
    const r = makeRenderer();
    r.setPresenting(false);
    const draw = vi.spyOn(r.app.renderer, 'render').mockImplementation(() => undefined);
    r.resize(160, 180);
    expect(draw).not.toHaveBeenCalled();
    const painted = vi.fn();
    r.onNextPaint(painted);
    r.resize(150, 170);
    expect(draw).toHaveBeenCalledOnce();
    expect(painted).toHaveBeenCalledOnce();
  });

  it('rests its ticker once the window closes, drawing nothing until asked', () => {
    // Only the timers are faked: pixi stamps `lastTime` from the real `performance.now()` when the
    // ticker starts, and that stamp must stay behind the test's clock below.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = makeRenderer();
    const spy = vi.spyOn(r.app.renderer, 'render').mockImplementation(() => undefined);
    // Pixi's Ticker ignores an update whose time has not advanced, so the clock is monotonic across
    // the batches rather than restarted per call.
    let now = performance.now();
    const tick = (n: number) => { for (let i = 0; i < n; i++) r.app.ticker.update((now += 16)); };

    r.requestRender();
    tick(4);                       // the whole window, one render each
    expect(spy).toHaveBeenCalledTimes(4);

    spy.mockClear();
    expect(r.app.ticker.started).toBe(false);
    vi.advanceTimersByTime(10_000);
    tick(14);
    expect(spy).not.toHaveBeenCalled();
    expect(r.app.ticker.started).toBe(false);
    r.setPresenting(false);
    vi.advanceTimersByTime(2000);
    expect(r.app.ticker.started).toBe(false);
    const painted = vi.fn();
    r.onNextPaint(painted);
    expect(r.app.ticker.started).toBe(true);
    tick(1);
    expect(painted).toHaveBeenCalledOnce();
    tick(1);
    expect(r.app.ticker.started).toBe(false);
  });
});

describe('the canvas beats on the 2D frame loop', () => {
  it('steps a beat with each drawn frame and keeps drawing until it lands', () => {
    const r = makeRenderer();
    vi.spyOn(r.app.renderer, 'render').mockImplementation(() => undefined);
    const seen: number[] = [];
    r.play(timedBeat(100, (t) => { seen.push(t); }));
    // Each resize draws one frame synchronously, at the clock's time.
    const now = vi.spyOn(performance, 'now');
    for (const at of [1000, 1050, 1100]) { now.mockReturnValue(at); r.resize(200, 200); }
    expect(seen).toEqual([0, 0.5, 1]);
  });

  it('lands every live beat on its end state when the view goes off screen, and any played there at once', () => {
    const r = makeRenderer();
    const ends: string[] = [];
    r.play(timedBeat(100, (t) => { if (t === 1) ends.push('timed'); }));
    r.play({ step: () => true, settle: () => { ends.push('open-ended'); } });
    r.setPresenting(false);
    expect(ends).toEqual(['timed', 'open-ended']);
    r.play(timedBeat(100, (t) => { if (t === 1) ends.push('hidden'); }));
    expect(ends).toEqual(['timed', 'open-ended', 'hidden']);
  });
});
