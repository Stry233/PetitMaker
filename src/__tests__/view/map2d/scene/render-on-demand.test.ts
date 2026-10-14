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
import * as PIXI from 'pixi.js-legacy';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { rendererLayers } from '../../../_support/renderer-layers';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';

/** The ticker's listener chain, which pixi keeps as a private linked list. */
function tickerListeners(ticker: PIXI.Ticker): Array<{ fn: unknown; context: unknown }> {
  const out: Array<{ fn: unknown; context: unknown }> = [];
  let node = (ticker as unknown as { _head: { next: unknown } })._head.next as
    | { fn: unknown; context: unknown; next: unknown }
    | null;
  while (node) {
    out.push({ fn: node.fn, context: node.context });
    node = node.next as typeof node;
  }
  return out;
}

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
      expect(rendererLayers(r).worldContainer.position.x).toBe(-r.viewport.getOffset().x);
      expect(rendererLayers(r).worldContainer.position.y).toBe(-r.viewport.getOffset().y);
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

  it('leaves exactly one listener on the ticker, and it is not pixi own render', () => {
    const r = makeRenderer();
    const listeners = tickerListeners(r.app.ticker);
    expect(listeners).toHaveLength(1);
    expect(listeners.some((l) => l.fn === r.app.render && l.context === r.app)).toBe(false);
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
