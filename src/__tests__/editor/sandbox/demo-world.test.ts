/** A Help figure's follow-ghost is the placement tool's own hover: the same cells, anchor, span and
 *  validity, drawn through the same overlay calls, for span items above all. */
import { describe, expect, it } from 'vitest';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { HELP_SCENES } from '../../../ui/help/figures/scenes';
import { BRIDGE, CABIN, RAMP, TREE } from '../../../ui/help/figures/scenes/common';
import { ObjectPlacerTool } from '../../../tools/pointer/objects/object-placer';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import type { ToolOverlay } from '../../../tools/pointer/runtime';
import { cellAtPoint } from '../../../core/grid/pointer';
import { mapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { Rotation } from '../../../core/model/types';
import { makeToolCtx } from '../../_support/tool-ctx';

/** An overlay that records every ghost call it receives. */
function recordingOverlay(): { overlay: ToolOverlay; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const overlay: ToolOverlay = {
    ...HEADLESS_OVERLAY,
    clearGhost: () => { calls.push(['clearGhost']); },
    showGhost: (set, opts) => { calls.push(['showGhost', set.grid, set.cells.map((c) => `${c.x},${c.y}`).sort(), opts]); },
    showPlacementGhost: (ghost, valid) => { calls.push(['showPlacementGhost', ghost, valid]); },
  };
  return { overlay, calls };
}

/** The objects figure's world: its walled pond, before any step runs. */
function pondWorld(): SandboxWorld {
  const scene = HELP_SCENES.objects!;
  const world = new SandboxWorld(scene.template);
  scene.run({ world, view: {} as never }, (key) => key);
  return world;
}

/** What the live placer draws with `catalogId` armed and the pointer at `at`. */
function toolHover(world: SandboxWorld, catalogId: string, at: { x: number; y: number }, rotation: Rotation): unknown[][] {
  const { overlay, calls } = recordingOverlay();
  const ctx = makeToolCtx(world.state, world.executor, 1, 1, { armedItem: catalogId, placementRotation: rotation, overlay });
  const p = mapPoint(at);
  ctx.point = p;
  new ObjectPlacerTool().onPointerMove(cellAtPoint(p, PLACEMENT_GRID), p, ctx);
  return calls;
}

function figureHover(world: SandboxWorld, catalogId: string, at: { x: number; y: number }, rotation: Rotation): unknown[][] {
  const { overlay, calls } = recordingOverlay();
  world.hoverPlacement(overlay, catalogId, mapPoint(at), rotation);
  return calls;
}

describe("a Help figure's follow-ghost", () => {
  const points = [
    { x: 71, y: 101 }, { x: 71.4, y: 101.6 }, { x: 72, y: 101 }, { x: 72.5, y: 102.5 }, { x: 70.2, y: 100.7 }, { x: 64, y: 99 },
  ];

  it.each([BRIDGE, RAMP])('draws what the placer draws for the span item %s', (catalogId) => {
    const world = pondWorld();
    let spans = 0;
    for (const at of points) {
      const figure = figureHover(world, catalogId, at, 0);
      expect(figure, `${catalogId} at ${at.x},${at.y}`).toEqual(toolHover(world, catalogId, at, 0));
      if (figure.some((call) => call[0] === 'showPlacementGhost' && call[2] === true)) spans++;
    }
    if (catalogId === BRIDGE) expect(spans).toBeGreaterThan(0);
  });

  it('draws what the placer draws for a footprint item at every turn', () => {
    const world = pondWorld();
    for (const rotation of [0, 90] as const) {
      for (const id of [TREE, CABIN]) {
        for (const at of points) expect(figureHover(world, id, at, rotation)).toEqual(toolHover(world, id, at, rotation));
      }
    }
  });
});
