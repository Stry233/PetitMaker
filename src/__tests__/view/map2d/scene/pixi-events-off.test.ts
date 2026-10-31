// @vitest-environment jsdom
/**
 * The 2D map is not a Pixi event target. Every listener is bound to the container by
 * `use-pointer-interaction` and hit testing is `state/object-index`, so Pixi's federated events are
 * pure overhead: with `features.move` on they walk the whole display list per pointermove, and even
 * with every feature off the event system keeps a callback on Pixi's system ticker, which requests an
 * animation frame on every frame of an otherwise resting page. This reads the live renderer, so a
 * renderer built with the event system fails here even though the source looks right.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';

describe('the 2D renderer runs without Pixi event handling', () => {
  it('builds no event system and leaves the system ticker without a callback', () => {
    const bus = new EventBus<EditorEvents>();
    const renderer = new MapRenderer(bus, document.createElement('div'), 64, 64);
    try {
      const pixi = (renderer as unknown as { app: { renderer: { events?: unknown } } }).app.renderer;
      expect(pixi.events).toBeUndefined();
      expect(PIXI.Ticker.system.count).toBe(0);
    } finally {
      renderer.destroy();
    }
  });
});
