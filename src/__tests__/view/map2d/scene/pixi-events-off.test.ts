// @vitest-environment jsdom
/**
 * The 2D map is not a Pixi event target. Every listener is bound to the container by
 * `use-pointer-interaction` and hit testing is `state/object-index`, so Pixi's federated events are
 * pure overhead: with `features.move` on they walk the whole display list per pointermove, on the
 * drag's critical path. This reads the live renderer's features, so a renamed or dropped
 * `eventFeatures` option fails here even though the source looks right.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';

describe('the 2D renderer runs with Pixi event handling off', () => {
  it('every event feature is disabled on the live renderer', () => {
    const bus = new EventBus<EditorEvents>();
    const renderer = new MapRenderer(bus, document.createElement('div'), 64, 64);
    try {
      const features = (renderer as unknown as { app: { renderer: { events: { features: Record<string, boolean> } } } })
        .app.renderer.events.features;
      expect(features).toMatchObject({ move: false, globalMove: false, click: false, wheel: false });
    } finally {
      renderer.destroy();
    }
  });
});
