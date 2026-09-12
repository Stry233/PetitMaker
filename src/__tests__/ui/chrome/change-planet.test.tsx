/**
 * Change a planet: the form that moves the visitor, and can bring the island's build with them.
 *
 * Two things it must never get wrong. The unsaved-export warning — switching replaces this map, and
 * the browser is the only copy of anything not exported (the undo stack's length at the last export
 * is the mark). And the verb: it names where it is going, it cannot be pressed before there is a
 * destination, and it reports the carry choice exactly as the visitor left it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { ChangePlanetModal } from '../../../ui/chrome/modals/ChangePlanetModal';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { createGrid } from '../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../config/maps';
import { CommandType, TerrainType, type Corners, type EditorEvents, type GridState } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;

/** The live editor, standing on a real planet — the modal reads which one it is. */
function world() {
  const state: GridState = {
    template: HEXIA,
    cells: createGrid(HEXIA),
    objects: new Map(),
    lockedLayers: new Set(),
  };
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  act(() => { useEditorStore.setState({ commandExecutor: executor, gridState: state, exportedAt: null, locale: 'en' }); });
  return { state, executor };
}

const paint = (executor: CommandExecutor, x: number) => act(() => {
  executor.execute({
    type: CommandType.PaintTerrain, timestamp: 1, cells: [{ x, y: 60 }],
    terrainType: TerrainType.Mountain, elevation: 1,
  });
});

/** A ground-level edge cut: a `None` cell at elevation 0 carrying corners. It occupies no layer, so
 *  no per-layer tally can see it, and it is exactly the work a "the island is empty" guard must not
 *  read as nothing. */
function cutGround(state: GridState, x: number, y: number) {
  const cell = state.cells[y]?.[x];
  if (cell) cell.terrain = { type: TerrainType.None, elevation: 0, corners: ['fan', 'square', 'square', 'square'] as Corners };
}

const show = (props: Partial<React.ComponentProps<typeof ChangePlanetModal>> = {}) => render(
  <I18nProvider>
    <ChangePlanetModal onSwitch={() => {}} onClose={() => {}} {...props} />
  </I18nProvider>,
);

// By testid, not by name: while the transfer runs the button's label is the busy dots.
const verb = () => screen.getByTestId('planet-switch') as HTMLButtonElement;

beforeEach(() => { useEditorStore.setState({ exportedAt: null, locale: 'en' }); });
afterEach(() => { cleanup(); useEditorStore.setState({ exportedAt: null }); });

describe('the unsaved-work warning', () => {
  const warned = () => !!screen.queryByText('Unexported changes will be lost.');

  it('stays quiet on a map nobody has touched', () => {
    world();
    show();
    expect(warned()).toBe(false);
  });

  it('speaks up once the map has edits that were never exported', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    expect(warned()).toBe(true);
  });

  it('goes quiet again after an export', () => {
    const w = world();
    paint(w.executor, 40);
    act(() => { useEditorStore.getState().markExported(); });
    show();
    expect(warned()).toBe(false);
  });

  it('and returns when the map moves on from that export', () => {
    const w = world();
    paint(w.executor, 40);
    act(() => { useEditorStore.getState().markExported(); });
    paint(w.executor, 42);
    show();
    expect(warned()).toBe(true);
  });

  it('offers the way out: close this, open the export', () => {
    const w = world();
    paint(w.executor, 40);
    const onClose = vi.fn();
    show({ onClose });
    act(() => { screen.getByText('Export first').click(); });
    expect(onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.exportJson).toBe(true);
  });
});

describe('the planet cards', () => {
  /* Every planet is a choice, the one under your feet included: choosing it means starting over
     there, which is the only thing it can mean and the thing the old window offered. */
  it('offers every planet, and marks the one you are on', () => {
    world();
    show();
    const here = screen.getByTestId(`planet-${HEXIA.id}`);
    expect(here.tagName).toBe('BUTTON');
    expect(here.getAttribute('aria-current')).toBe('true');
    const other = screen.getByTestId(`planet-${TAFA.id}`);
    expect(other.tagName).toBe('BUTTON');
    expect(other.getAttribute('aria-current')).toBeNull();
  });
});

describe('the carry question', () => {
  it('is not asked on an island with nothing on it', () => {
    world();
    show();
    expect(screen.queryByText('What you have built')).toBeNull();
  });

  it('is asked once anything has been built', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    expect(screen.getByText('What you have built')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bring it along' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeTruthy();
  });

  it('carries the stakes with it in one line, and does not quote a keep rate', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    const hint = screen.getByText(/switching cannot be undone/);
    expect(hint.textContent).toContain('left behind');
    expect(hint.textContent).not.toMatch(/\d%/);
    // One sentence: what the segmented control already names does not get a second telling.
    expect(hint.textContent!.match(/\./g)).toHaveLength(1);
  });
});

describe('choosing the planet you are on', () => {
  it('means starting over: no carry question, and the verb says so', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    // The carry row is on screen while the destination is elsewhere.
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    expect(screen.queryByText('What you have built')).toBeTruthy();

    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    expect(screen.queryByText('What you have built')).toBeNull();
    expect(verb().textContent).toBe('Start over');
    expect(verb().disabled).toBe(false);
  });

  it('carries the stakes where the verb is, since the carry row is gone', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    const hint = screen.getByTestId('planet-start-over-hint');
    expect(hint.textContent).toBe('This clears everything you have built, and cannot be undone.');
  });

  it('and says nothing about stakes on an island with nothing to lose', () => {
    world();
    show();
    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    expect(verb().textContent).toBe('Start over');
    expect(screen.queryByTestId('planet-start-over-hint')).toBeNull();
  });

  it('takes the fresh path on this same planet, whatever the carry row was left on', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    // Left on "bring it along", then the destination changes to here: carrying to where you already
    // are is meaningless, so the press must not report it.
    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    await act(async () => {
      fireEvent.click(verb());
      await new Promise((r) => { setTimeout(r, 0); });
    });
    expect(onSwitch).toHaveBeenCalledWith(HEXIA.id, false);
  });
});

describe('the verb', () => {
  it('cannot be pressed before there is a destination', () => {
    world();
    const onSwitch = vi.fn();
    show({ onSwitch });
    expect(verb().disabled).toBe(true);
    expect(verb().textContent).toBe('Switch planet');
    fireEvent.click(verb());
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('names the planet it is going to once one is chosen', () => {
    world();
    show();
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    expect(verb().disabled).toBe(false);
    expect(verb().textContent).toBe(`Switch to ${TAFA.name.en}`);
  });

  it('takes the build along by default', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await act(async () => {
      fireEvent.click(verb());
      // The press yields one macrotask so its busy state paints before the transfer takes the thread.
      await new Promise((r) => { setTimeout(r, 0); });
    });
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, true);
  });

  it('counts a map whose only work is ground-level cuts as a build, and carries it', async () => {
    const w = world();
    cutGround(w.state, 40, 60);
    const onSwitch = vi.fn();
    show({ onSwitch });
    // The transfer replays such a cell, so the window must offer the choice rather than deciding
    // for itself that there is nothing here.
    expect(screen.getByText('What you have built')).toBeTruthy();
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await act(async () => {
      fireEvent.click(verb());
      await new Promise((r) => { setTimeout(r, 0); });
    });
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, true);
  });

  it('asks for no transfer at all when the island is empty', async () => {
    world();
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await act(async () => {
      fireEvent.click(verb());
      await new Promise((r) => { setTimeout(r, 0); });
    });
    // The carry row is not on screen for an empty island, so the 'carry' it still holds is not an
    // answer anyone gave: there is nothing to move and nothing to spend a replay on.
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, false);
  });

  it('leaves it behind when the visitor says so', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await act(async () => {
      fireEvent.click(verb());
      await new Promise((r) => { setTimeout(r, 0); });
    });
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, false);
  });

  it('acts once however many times it is pressed', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await act(async () => {
      fireEvent.click(verb());
      fireEvent.click(verb());
      fireEvent.click(verb());
      await new Promise((r) => { setTimeout(r, 0); });
    });
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  /* A close during the busy window would read as a cancel, and there is nothing to cancel: the
     replay is already under way and installs its map either way. */
  it('cannot be dismissed while the transfer is running', async () => {
    const w = world();
    paint(w.executor, 40);
    const onClose = vi.fn();
    const onSwitch = vi.fn();
    show({ onClose, onSwitch });
    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    // Pressed but not yet flushed: this IS the busy window, one macrotask wide.
    fireEvent.click(verb());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('and a transfer that throws leaves the window usable rather than stuck under its dots', () => {
    vi.useFakeTimers();
    try {
      const w = world();
      paint(w.executor, 40);
      const onClose = vi.fn();
      show({ onClose, onSwitch: () => { throw new Error('replay failed'); } });
      fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
      fireEvent.click(verb());
      // The press yields a macrotask, so the throw lands here rather than in the click.
      expect(() => act(() => { vi.runAllTimers(); })).toThrow('replay failed');
      // The throw came out of the act that would have flushed the finally's state update.
      act(() => {});
      expect(verb().disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('and the quiet way out just closes', () => {
    world();
    const onClose = vi.fn();
    const onSwitch = vi.fn();
    show({ onClose, onSwitch });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

// The unsaved-work row and the carry row can both be on screen at once, and a landscape phone
// (390-412 css px tall) is shorter than that combined height at FIT_FLOOR — `cozyOverlay` has no
// page scroll of its own, so without a cap the Switch/Cancel buttons go unreachable.
describe('the card height cap', () => {
  it('bounds the card and scrolls its own content rather than clipping it', () => {
    world();
    show();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.maxHeight).toMatch(/vh$/);
    expect(dialog.style.overflowY).toBe('auto');
  });
});
