/** Mode shortcuts toggle their surface; terrain tool shortcuts keep the selected tool armed. */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RUN, type CommandContext } from '../../../editor/commands/commands';
import { ACTION_BY_ID, openBuildSurface, runTileAction } from '../../../editor/commands/actions';
import { offerSmartBuild } from '../../../editor/commands/smart-build';
import { useEditorStore } from '../../../state/store';
import { setStoreState } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import type { DesignMode } from '../../../state/editing/vocabulary';
import type { RunCommandId } from '../../../state/keymap/registry';
import { activeToolOf, designModeOf, buildShapeOf, holdsSelection } from '../../../state/editing/edit-mode';

// The tap verbs are pinned on their own (`actions.test.ts`); here, which one a key reaches for.
vi.mock('../../../editor/commands/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../editor/commands/actions')>()),
  openBuildSurface: vi.fn(),
  runTileAction: vi.fn(),
}));

function fakeCtx(): CommandContext & { toggleMenu: Mock<CommandContext['toggleMenu']> } {
  return { toggleMenu: vi.fn() };
}

const tile = vi.mocked(runTileAction);
const build = vi.mocked(openBuildSurface);

/** Rest: nothing chosen and nothing armed, which is where a key arms rather than puts away. */
beforeEach(() => { vi.clearAllMocks(); useEditorStore.getState().setEditMode({ mode: null }); });

describe('select-all enters selection', () => {
  /**
   * Ctrl+A with a brush or macro armed leaves for the Hand tool: an armed tool cannot hold a
   * selection (`state/editing/edit-mode.ts:holdsSelection`). Putting the tool away is the same
   * "leave the brush, keep the surface" move a selection gesture makes.
   */
  it('puts an armed brush away so the selection it makes can stand', () => {
    const state = makeState(12, 12);
    state.objects.set('o1', { id: 'o1', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });
    setStoreState({ gridState: state });
    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });

    RUN['selection.all']({} as never);
    const s = useEditorStore.getState();
    expect(s.selection.map((r) => r.kind === 'object' && r.id)).toEqual(['o1']);
    expect(holdsSelection(activeToolOf(s)), 'the tool now holds what the command made').toBe(true);
    expect(s.editMode.mode, 'the surface itself stays').toBe('mountain');
    useEditorStore.getState().clearSelection();
    setStoreState({ gridState: null });
  });
});

describe('RUN dispatches home-tile shortcuts to the exact editor/commands/actions entry a tap runs', () => {
  const cases: Array<[RunCommandId, string]> = [
    ['surface.mountain', 'mountain'],
    ['surface.river', 'river'],
    ['surface.road', 'road'],
    ['tool.move', 'move'],
    ['app.generate', 'generate'],
    ['app.new', 'new'],
    ['app.export_json', 'export'],
    ['app.export_image', 'image'],
  ];

  for (const [commandId, actionId] of cases) {
    it(`${commandId} -> runTileAction(ACTION_BY_ID.get('${actionId}'))`, () => {
      const ctx = fakeCtx();
      RUN[commandId](ctx);
      expect(tile).toHaveBeenCalledWith(ACTION_BY_ID.get(actionId));
      expect(build).not.toHaveBeenCalled();
      expect(ctx.toggleMenu).not.toHaveBeenCalled();
    });
  }
});

describe('RUN dispatches build-tool shortcuts to the exact DesignMode a tap opens', () => {
  const cases: Array<[RunCommandId, DesignMode]> = [
    ['tool.brush', 'free'],
    ['tool.erase', 'erase'],
    ['tool.rect', 'rect'],
    ['tool.circle', 'circle'],
    ['tool.line', 'line'],
    ['tool.curve', 'curve'],
    ['tool.trim', 'trim'],
  ];

  for (const [commandId, mode] of cases) {
    it(`${commandId} -> openBuildSurface('${mode}')`, () => {
      const ctx = fakeCtx();
      RUN[commandId](ctx);
      expect(build).toHaveBeenCalledWith(mode);
      expect(tile).not.toHaveBeenCalled();
    });
  }
});

describe('repeated mode and terrain tool shortcuts', () => {
  /** Each surface key, the mode it lands on, and the key that reaches it. */
  const surfaces: Array<[RunCommandId, 'mountain' | 'water' | 'road']> = [
    ['surface.mountain', 'mountain'],
    ['surface.river', 'water'],
    ['surface.road', 'road'],
  ];

  for (const [commandId, mode] of surfaces) {
    it(`${commandId} pressed on the mode it chose runs the move tile, which is rest`, () => {
      const ctx = fakeCtx();
      useEditorStore.getState().setEditMode({ mode });
      RUN[commandId](ctx);
      expect(tile).toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
    });

    it(`${commandId} pressed on ANOTHER mode still chooses its own`, () => {
      const ctx = fakeCtx();
      useEditorStore.getState().setEditMode({ mode: mode === 'mountain' ? 'water' : 'mountain' });
      RUN[commandId](ctx);
      expect(tile).not.toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
    });
  }

  it('app.generate is one of the mode blocks and toggles like the rest', () => {
    const ctx = fakeCtx();
    useEditorStore.getState().setEditMode({ mode: 'generate' });
    RUN['app.generate'](ctx);
    expect(tile).toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
  });

  const tools: Array<[RunCommandId, DesignMode]> = [
    ['tool.rect', 'rect'],
    ['tool.circle', 'circle'],
    ['tool.line', 'line'],
    ['tool.curve', 'curve'],
  ];

  it.each([
    ['tool.brush', 'free'],
    ['tool.erase', 'erase'],
    ['tool.trim', 'trim'],
  ] as const)('%s toggles off and on while retaining the terrain surface', (commandId, design) => {
    const ctx = fakeCtx();
    useEditorStore.getState().setEditMode({ mode: 'water', arm: { kind: 'none' } });
    RUN[commandId](ctx);
    expect(designModeOf(useEditorStore.getState())).toBe(design);
    RUN[commandId](ctx);
    expect(designModeOf(useEditorStore.getState())).toBe('none');
    expect(useEditorStore.getState().editMode.mode).toBe('water');
    RUN[commandId](ctx);
    expect(designModeOf(useEditorStore.getState())).toBe(design);
    expect(build).not.toHaveBeenCalled();
  });

  for (const [commandId, design] of tools) {
    it(`${commandId} keeps the selected terrain tool and surface on repeated presses`, () => {
      const ctx = fakeCtx();
      useEditorStore.getState().setEditMode({ mode: 'water', arm: { kind: 'brush' } });
      RUN[commandId](ctx);
      expect(designModeOf(useEditorStore.getState())).toBe(design);
      RUN[commandId](ctx);
      expect(designModeOf(useEditorStore.getState())).toBe(design);
      expect(useEditorStore.getState().editMode.mode).toBe('water');
      expect(build).not.toHaveBeenCalled();
    });
  }

  it('reselecting a drawing shape retains that shape', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'circle' } });
    RUN['tool.circle'](fakeCtx());
    expect(buildShapeOf(useEditorStore.getState())).toBe('circle');
  });
});

describe('the smart-build key reaches the cell, and only while one is showing', () => {
  it('presses whatever cell is mounted', () => {
    const pressed = vi.fn();
    const withdraw = offerSmartBuild(pressed);
    RUN['tool.smart'](fakeCtx());
    expect(pressed).toHaveBeenCalledOnce();
    withdraw();
  });

  it('does nothing with no tool row on screen', () => {
    expect(() => RUN['tool.smart'](fakeCtx())).not.toThrow();
  });
});

describe('RUN dispatches the menu shortcut to toggleMenu, not a tile action', () => {
  it("app.menu -> toggleMenu()", () => {
    const ctx = fakeCtx();
    RUN['app.menu'](ctx);
    expect(ctx.toggleMenu).toHaveBeenCalledOnce();
    expect(tile).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });
});
