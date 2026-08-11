/**
 * "New map" replaces the one on screen, and the browser is the only copy of anything not exported.
 * The undo stack's length at the last export is the mark: anything past it lives only here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { NewProjectModal } from '../../../ui/chrome/modals/NewProjectModal';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { CommandType, TerrainType, type EditorEvents } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';

function world() {
  const state = makeState(20, 20);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  act(() => { useEditorStore.setState({ commandExecutor: executor, gridState: state, exportedAt: null }); });
  return { state, executor };
}

const paint = (executor: CommandExecutor, x: number) => act(() => {
  executor.execute({
    type: CommandType.PaintTerrain, timestamp: 1, cells: [{ x, y: 5 }],
    terrainType: TerrainType.Mountain, elevation: 1,
  });
});

// Mounted without an I18nProvider, `useT` hands back the key — which is the stable thing to look
// for here anyway: the test is about WHEN the notice appears, not how it is worded.
const warned = () => !!screen.queryByText('modal.new_unsaved');

beforeEach(() => { useEditorStore.setState({ exportedAt: null }); });
afterEach(() => { cleanup(); useEditorStore.setState({ exportedAt: null }); });

describe('the new-map warning', () => {
  it('stays quiet on a map nobody has touched', () => {
    world();
    render(<NewProjectModal onSelect={() => {}} onClose={() => {}} />);
    expect(warned()).toBe(false);
  });

  it('speaks up once the map has edits that were never exported', () => {
    const w = world();
    paint(w.executor, 4);

    render(<NewProjectModal onSelect={() => {}} onClose={() => {}} />);
    expect(warned()).toBe(true);
  });

  it('goes quiet again after an export', () => {
    const w = world();
    paint(w.executor, 4);
    act(() => { useEditorStore.getState().markExported(); });
    render(<NewProjectModal onSelect={() => {}} onClose={() => {}} />);
    expect(warned()).toBe(false);
  });

  it('and returns when the map moves on from that export', () => {
    const w = world();
    paint(w.executor, 4);
    act(() => { useEditorStore.getState().markExported(); });
    paint(w.executor, 6);
    render(<NewProjectModal onSelect={() => {}} onClose={() => {}} />);
    expect(warned()).toBe(true);
  });

  it('offers the way out: close this, open the export', () => {
    const w = world();
    paint(w.executor, 4);
    const onClose = vi.fn();
    render(<NewProjectModal onSelect={() => {}} onClose={onClose} />);
    act(() => { screen.getByText('modal.new_export_first').click(); });
    expect(onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.exportJson).toBe(true);
  });
});
