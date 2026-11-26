/** Mode shortcuts toggle their surface; terrain tool shortcuts keep the selected tool armed. */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RUN, type CommandContext } from '../../../editor/commands/commands';
import { ACTION_BY_ID, runTileAction } from '../../../editor/commands/actions';
import { showPlanting } from '../../../editor/editing/object-shelf';
import { getRoadMaterials } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { resetStore, setStoreState } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import type { DesignMode } from '../../../state/editing/vocabulary';
import type { RunCommandId } from '../../../state/keymap/registry';
import { activeToolOf, armedMacroOf, designModeOf, buildShapeOf, holdsSelection, type BuildMode } from '../../../state/editing/edit-mode';

function fakeCtx(): CommandContext & { toggleMenu: Mock<CommandContext['toggleMenu']> } {
  return { toggleMenu: vi.fn() };
}

/** What a press leaves on screen: the surface and the tool on it, the windows open and the section
 *  the share window opens at, and whether the region brush is out. */
function seen() {
  const s = useEditorStore.getState();
  return { mode: s.editMode.mode, design: designModeOf(s), modals: s.modals, shareTarget: s.shareTarget, selectingRegion: s.selectingRegion };
}

/** Rest: nothing chosen, nothing armed and no window open, which is where a key arms rather than puts away. */
beforeEach(() => { resetStore(); });

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

describe('home-tile shortcuts do what a tap on the tile does', () => {
  /** Each key, the tile it stands for, and the mode the editor is in when it is pressed. */
  const cases: Array<[RunCommandId, string, BuildMode]> = [
    ['surface.mountain', 'mountain', null],
    ['surface.river', 'river', null],
    ['surface.road', 'road', null],
    ['tool.move', 'move', 'water'],
    ['app.generate', 'generate', null],
    ['app.new', 'new', null],
    ['app.export_json', 'export', null],
    ['app.export_image', 'image', null],
  ];

  for (const [commandId, actionId, from] of cases) {
    it(`[EDIT-40] ${commandId} leaves the editor as tapping the ${actionId} tile does`, () => {
      const start = (): void => { resetStore(); useEditorStore.getState().setEditMode({ mode: from }); };
      start();
      const before = seen();
      RUN[commandId](fakeCtx());
      const byKey = seen();
      start();
      runTileAction(ACTION_BY_ID.get(actionId)!);
      expect(byKey).toEqual(seen());
      expect(byKey, 'the press changed what is on screen').not.toEqual(before);
    });
  }
});

describe('build-tool shortcuts pressed at rest open the mountain surface with their tool', () => {
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
    it(`${commandId} arms ${mode} on the mountain surface`, () => {
      RUN[commandId](fakeCtx());
      const s = useEditorStore.getState();
      expect([s.editMode.mode, designModeOf(s)]).toEqual(['mountain', mode]);
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
    it(`${commandId} pressed on the mode it chose returns to rest`, () => {
      useEditorStore.getState().setEditMode({ mode });
      RUN[commandId](fakeCtx());
      expect(useEditorStore.getState().editMode.mode).toBeNull();
    });

    it(`${commandId} pressed on another mode still chooses its own`, () => {
      useEditorStore.getState().setEditMode({ mode: mode === 'mountain' ? 'water' : 'mountain' });
      RUN[commandId](fakeCtx());
      expect(useEditorStore.getState().editMode.mode).toBe(mode);
    });
  }

  it('app.generate is one of the mode blocks and toggles like the rest', () => {
    RUN['app.generate'](fakeCtx());
    expect(useEditorStore.getState().editMode.mode).toBe('generate');
    RUN['app.generate'](fakeCtx());
    expect(useEditorStore.getState().editMode.mode).toBeNull();
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
    });
  }

  it('reselecting a drawing shape retains that shape', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'circle' } });
    RUN['tool.circle'](fakeCtx());
    expect(buildShapeOf(useEditorStore.getState())).toBe('circle');
  });
});

describe('the smart-build key has a body of its own, with no control on screen', () => {
  it.each([['mountain', 'raise'], ['water', 'stream'], ['road', 'road-link']] as const)('arms the %s surface\'s macro, and puts the smart tool down on a second press', (surface, macro) => {
    useEditorStore.getState().setEditMode({ mode: surface, arm: { kind: 'brush' } });
    RUN['tool.smart'](fakeCtx());
    expect(armedMacroOf(useEditorStore.getState())).toBe(macro);
    RUN['tool.smart'](fakeCtx());
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();
    expect(useEditorStore.getState().editMode.mode).toBe(surface);
  });

  it('leaves the tool in hand where the surface offers no Smart Build: a road with a print armed', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'road', arm: { kind: 'erase' } });
    s.setTileMaterial(getRoadMaterials(true)[0]!.id);
    const before = useEditorStore.getState().editMode;
    RUN['tool.smart'](fakeCtx());
    expect(useEditorStore.getState().editMode).toEqual(before);
  });

  it('arms the planting card the object shelf\'s row shows, and nothing once the row shows none', () => {
    useEditorStore.getState().setEditMode({ mode: 'object' });
    const withdraw = showPlanting('patch-tree');
    RUN['tool.smart'](fakeCtx());
    expect(armedMacroOf(useEditorStore.getState())).toBe('patch-tree');
    RUN['tool.smart'](fakeCtx());
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();
    withdraw();
    RUN['tool.smart'](fakeCtx());
    expect(armedMacroOf(useEditorStore.getState())).toBeNull();
  });

  it('does nothing at rest', () => {
    const before = useEditorStore.getState().editMode;
    RUN['tool.smart'](fakeCtx());
    expect(useEditorStore.getState().editMode).toEqual(before);
  });
});

describe('RUN dispatches the menu shortcut to toggleMenu, not a tile action', () => {
  it("app.menu -> toggleMenu()", () => {
    const ctx = fakeCtx();
    const before = seen();
    RUN['app.menu'](ctx);
    expect(ctx.toggleMenu).toHaveBeenCalledOnce();
    expect(seen(), 'no surface, tool or window changed').toEqual(before);
  });
});
