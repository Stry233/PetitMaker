/** Undo and Redo while a build is still landing on the map: the landing is what they take back; and
 *  whether each has a step, which the commands answer as their present value in every lane. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RUN } from '../../../editor/commands/commands';
import { listCommands, runCommand } from '../../../editor/commands/run';
import { useEditorStore } from '../../../state/store';
import { resetStore } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { createDefaultRegistry } from '../../../rules';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';

const s = () => useEditorStore.getState();

beforeEach(() => {
  resetStore();
  s().loadMap(makeState(12, 12), createDefaultRegistry());
  s().commandExecutor!.execute(paintTerrainCommand([{ x: 2, y: 2 }], TerrainType.Mountain, 1));
});

describe.each(['history.undo', 'history.redo'] as const)('%s with a build landing', (command) => {
  it('[GEN-09] cancels the landing and steps nothing else, then steps the history on the next press', () => {
    if (command === 'history.redo') s().commandExecutor!.undo();
    const depth = s().commandExecutor!.historyDepth();
    const cancel = vi.fn();
    const release = holdEditInFlight(() => { cancel(); release(); }, 'build');
    RUN[command]({ toggleMenu: vi.fn() });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(s().commandExecutor!.historyDepth()).toBe(depth);
    RUN[command]({ toggleMenu: vi.fn() });
    expect(s().commandExecutor!.historyDepth()).toBe(command === 'history.undo' ? depth - 1 : depth + 1);
  });
});

/** Whether undo and redo have a step, as the commands answer it. */
const steps = () => {
  const current = (id: string) => listCommands().find((command) => command.id === id)?.current;
  return { undo: current('history.undo'), redo: current('history.redo') };
};

describe('whether undo and redo have a step', () => {
  it('follows the map\'s history as it is stepped', async () => {
    expect(steps()).toEqual({ undo: true, redo: false });
    await runCommand('history.undo');
    expect(steps()).toEqual({ undo: false, redo: true });
    await runCommand('history.redo');
    expect(steps()).toEqual({ undo: true, redo: false });
  });

  it('[GEN-09] holds for both while a build lands, since either press takes the landing back', async () => {
    s().commandExecutor!.undo();
    const release = holdEditInFlight(() => release(), 'build');
    expect(steps()).toEqual({ undo: true, redo: true });
    await runCommand('history.undo');
    expect(steps(), 'the landing went and the history did not step').toEqual({ undo: false, redo: true });
  });

  it('reads the region brush\'s own lane while a region is painted, whatever the map\'s history holds', async () => {
    s().setSelectingRegion(true, 'generator');
    expect(steps()).toEqual({ undo: false, redo: false });
    s().commitRegion([{ x: 1, y: 1 }]);
    expect(steps()).toEqual({ undo: true, redo: false });
    await runCommand('history.undo');
    expect(steps()).toEqual({ undo: false, redo: true });
    expect(s().commandExecutor!.canUndo(), 'the map\'s history did not step').toBe(true);
  });

  it('reads the notes\' own lane in Notes', async () => {
    s().setEditMode({ mode: 'annotate' });
    expect(steps()).toEqual({ undo: false, redo: false });
    s().addAnnotation({ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 2, y: 4 }, { x: 8, y: 4 }] });
    expect(steps()).toEqual({ undo: true, redo: false });
    await runCommand('history.undo');
    expect(steps()).toEqual({ undo: false, redo: true });
  });
});
