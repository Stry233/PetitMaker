/**
 * MapRenderer's own gated tick is the ONLY thing that draws.
 *
 * Pixi's TickerPlugin registers `app.render` on the application ticker inside the `ticker` property
 * setter, i.e. when the Application is CONSTRUCTED; `autoStart` gates only whether the ticker is
 * started. Starting it ourselves for `renderTick` therefore ran pixi's ungated whole-scene render
 * beside the gated one — measured at exactly 2.00 renders per frame while panning a dense map, and
 * one full repaint per frame on an untouched map instead of the ~4fps heartbeat.
 */
import './_pixi-env';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';

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
});

describe('render-on-demand loop', () => {
  it('leaves exactly one listener on the ticker, and it is not pixi own render', () => {
    const r = makeRenderer();
    const listeners = tickerListeners(r.app.ticker);
    expect(listeners).toHaveLength(1);
    expect(listeners.some((l) => l.fn === r.app.render && l.context === r.app)).toBe(false);
  });

  it('renders only while the window is open, then at the heartbeat', () => {
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
    tick(14);                      // window closed, heartbeat not yet due
    expect(spy).not.toHaveBeenCalled();

    tick(1);                       // the ~4fps safety floor
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
