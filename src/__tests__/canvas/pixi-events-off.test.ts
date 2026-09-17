/**
 * The 2D map is not a Pixi event target.
 *
 * Every pointer, wheel and context-menu listener the map has is bound to the CONTAINER by
 * `canvas/interaction/usePointerInteraction`, and "what is under the pointer" is answered by
 * `state/object-index`. Pixi's own federated event system is therefore pure overhead — and not a
 * small one: with `features.move` on it walks the whole display list per pointermove
 * (`hitTestMoveRecursive` + `_interactivePrune`/`isInteractive` per node), which on a decorated map
 * is thousands of nodes, on the drag's critical path, growing with every object a stroke lays.
 * Measured in a real browser on a generated map (2900 objects), that walk was ~1.2 ms per
 * pointer move and about a fifth of a road stroke's whole scripting cost.
 *
 * This asserts the LIVE renderer's features rather than the constructor's options text, so it also
 * pins that the option name is one this Pixi honours: a renamed or dropped `eventFeatures` would
 * leave the walk running with the source still looking correct.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';

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
