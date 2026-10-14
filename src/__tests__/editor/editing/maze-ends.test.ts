/**
 * The maze's ends as recipe settings: choosing them adopts a landed run's pair, a dropped mark is
 * the new setting and re-lands the run, and turning the choice off takes the way switch with it.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createMazeEnds, type MazeEndsInputs } from '../../../editor/editing/maze-ends';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { useEditorStore } from '../../../state/store';
import type { Outcome } from '../../../editor/operations';

let inputs: MazeEndsInputs;
beforeAll(() => {
  newMap(editorPort, 'hexia');
  inputs = { maze: true, gridState: useEditorStore.getState().gridState, scope: null, corridorWidth: 1 };
});

describe('the maze ends', () => {
  it('offers no gates until the visitor chooses the ends, then the default pair', () => {
    const ends = createMazeEnds();
    expect(ends.view(inputs).gates).toBeNull();
    ends.toggleEnds();
    const view = ends.view(inputs);
    expect(view.customEnds).toBe(true);
    expect(view.gates).not.toBeNull();
    expect(view.shown).not.toBeNull();
  });

  it('adopts the pair a landed run opened', () => {
    const ends = createMazeEnds();
    const gates = { entrance: { x: 10, y: 10 }, exit: { x: 30, y: 30 } };
    ends.landed({ ok: true, detail: { kind: 'maze', gates, walk: [] } } as unknown as Outcome);
    ends.toggleEnds();
    expect(ends.view(inputs).gates).toEqual(gates);
  });

  it('re-lands with a dropped mark and keeps it as the setting', () => {
    const ends = createMazeEnds();
    ends.toggleEnds();
    const before = ends.view(inputs).shown!;
    const reland = vi.fn();
    const target = before.exit!.cell;
    ends.moveEnd('entrance', target, false, reland);
    expect(reland).not.toHaveBeenCalled();
    ends.moveEnd('entrance', target, true, reland);
    expect(reland).toHaveBeenCalledTimes(1);
    expect(ends.view(inputs).gates).toEqual(reland.mock.calls[0]![0]);
  });

  it('turns the way switch off with the choice', () => {
    const ends = createMazeEnds();
    ends.toggleEnds();
    ends.setShowWay(true);
    ends.toggleEnds();
    expect(ends.view(inputs)).toMatchObject({ customEnds: false, showWay: false, gates: null });
  });
});
