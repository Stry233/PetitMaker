/**
 * The eraser's ghost preview must render on the grid that matches what a click would actually
 * erase: terrain (mountain/river) is micro-grid (offset -HALF_TILE), tiles/roads are macro-grid
 * (no offset) — same rule ToolOverlay.showGhost's `terrainGrid` flag already encodes for the
 * paint brushes (drawing-tool.ts). The eraser used to omit the argument entirely, which defaults
 * to `true` (micro), so a tile-mode erase ghost sat half a tile off from the cell it would erase.
 */
import { describe, it, expect, vi } from 'vitest';
import { EraserTool } from '../../tools/paint/eraser';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents, type MacroCoord } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { roadLookup } from '../../state/object-index';

const m = (x: number, y: number): MacroCoord => ({ x, y });

describe('EraserTool: ghost grid alignment', () => {
  it('draws the ghost on the MACRO grid (no offset) while erasing tiles', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const showGhost = vi.fn();
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { contentType: 'tile' }),
      overlay: { showGhost, clearGhost: vi.fn(), flashCommit: vi.fn() },
    } as any;

    new EraserTool().onPointerMove(m(5, 5), m(5, 5), ctx);

    expect(showGhost).toHaveBeenCalledTimes(1);
    expect(showGhost.mock.calls[0]![2]).toBe(false); // macro grid: tiles/roads have no offset
  });

  it('draws the ghost on the MICRO (terrain) grid while erasing mountain/river', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const showGhost = vi.fn();
    const ctx = { ...makeToolCtx(state, executor), overlay: { showGhost, clearGhost: vi.fn(), flashCommit: vi.fn() } } as any;

    new EraserTool().onPointerMove(m(5, 5), m(5, 5), ctx);

    expect(showGhost).toHaveBeenCalledTimes(1);
    expect(showGhost.mock.calls[0]![2]).toBe(true); // micro grid: matches the -HALF_TILE terrain offset
  });

  it('the erase HIT TARGET (not just the ghost) is macro-cell-accurate in tile mode: same coords in, same cell erased', () => {
    // Regression guard for the report's other question: eraseTileCells/getCell both index the
    // cells array by the plain macro (x,y) the pointer machine resolves — there is no separate
    // micro-space hit test to get wrong, unlike the ghost's PIXEL offset. TerrainType import kept
    // for parity with the other eraser test's fixture style.
    const state = makeState(10, 10);
    // elevation 1 → the peel's elev-1 clears to null in one click (see terrain-peel.ts).
    state.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 1, corners: ['square', 'square', 'square', 'square'] };
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const eraser = new EraserTool();
    const ctx = makeToolCtx(state, executor);
    eraser.onPointerDown(m(5, 5), m(5, 5), ctx);
    eraser.onPointerUp(m(5, 5), m(5, 5), ctx);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });
});
