/**
 * The part of "a keyboard shortcut reaches the same tile a click does" that is genuinely
 * shell-independent: `kit/commands.ts`'s RUN table dispatches each surface/tool/app shortcut to
 * the CommandContext's `handleTileAction`/`openBuild`/`toggleMenu`, naming the exact `kit/actions`
 * entry or `DesignMode` a shell's implementation receives. What THAT implementation then does with
 * it (arm a tool, remember a surface, open the menu sheet) belongs to the shell: this frame builds
 * the context in `ui/shell/use-shell-commands.ts`, and none of it is pinned here.
 *
 * And the second press, which is the same question asked of a key that is already answered: a key
 * that CHOOSES something puts it away again, because the control it stands for does. The two
 * retreats differ, so both are pinned here — a mode leaves entirely, a tool leaves its surface
 * standing.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RUN, type CommandContext } from '../../kit/commands';
import { ACTION_BY_ID } from '../../kit/actions';
import { offerSmartBuild } from '../../core/runtime/smart-build';
import { useEditorStore } from '../../state/store';
import { setStoreState } from '../_store';
import { canHoldSelection } from '../../core/interaction/tool-modes';
import { makeState } from '../rules/_helpers';
import { designModeToEditInputs } from '../../core/model/edit-mode';
import type { DesignMode } from '../../core/model/types';

function fakeCtx(): CommandContext & {
  handleTileAction: Mock<CommandContext['handleTileAction']>;
  openBuild: Mock<CommandContext['openBuild']>;
  toggleMenu: Mock<CommandContext['toggleMenu']>;
} {
  return {
    openBuild: vi.fn(),
    handleTileAction: vi.fn(),
    toggleMenu: vi.fn(),
  };
}

/** Rest: nothing chosen and nothing armed, which is where a key ARMS rather than puts away. */
beforeEach(() => useEditorStore.getState().setEditMode({ mode: null }));

describe('select-all enters selection', () => {
  /**
   * Ctrl+A with a brush or macro armed is a silent no-op unless the command puts the tool away
   * first: an armed tool cannot hold a selection, so the mode rule (`selection-view-sync`) drops
   * the set in the same tick it is made. Putting the tool away is the same "leave the brush, keep
   * the surface" move a selection gesture makes, and it is what lets the set survive.
   */
  it('puts an armed brush away so the selection it makes can stand', () => {
    const state = makeState(12, 12);
    state.objects.set('o1', { id: 'o1', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });
    setStoreState({ gridState: state });
    useEditorStore.getState().setEditMode({ mode: 'mountain', tool: 'brush', shape: 'free' });

    RUN['selection.all']!({} as never);
    const s = useEditorStore.getState();
    expect(s.selection.map((r) => r.kind === 'object' && r.id)).toEqual(['o1']);
    expect(canHoldSelection(s.activeTool), 'the tool now holds what the command made').toBe(true);
    expect(s.editMode.mode, 'the surface itself stays').toBe('mountain');
    useEditorStore.getState().clearSelection();
    setStoreState({ gridState: null });
  });
});

describe('RUN dispatches home-tile shortcuts to the exact kit/actions entry a shell receives', () => {
  const cases: Array<[string, string]> = [
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
    it(`${commandId} -> handleTileAction(ACTION_BY_ID.get('${actionId}'))`, () => {
      const ctx = fakeCtx();
      RUN[commandId]!(ctx);
      expect(ctx.handleTileAction).toHaveBeenCalledWith(ACTION_BY_ID.get(actionId));
      expect(ctx.openBuild).not.toHaveBeenCalled();
      expect(ctx.toggleMenu).not.toHaveBeenCalled();
    });
  }
});

describe('RUN dispatches build-tool shortcuts to the exact DesignMode a shell receives', () => {
  const cases: Array<[string, DesignMode]> = [
    ['tool.brush', 'brush'],
    ['tool.eraser', 'eraser'],
    ['tool.rect', 'rect'],
    ['tool.circle', 'circle'],
    ['tool.line', 'line'],
    ['tool.curve', 'curve'],
    ['tool.edgecut', 'edge-cut'],
  ];

  for (const [commandId, mode] of cases) {
    it(`${commandId} -> openBuild('${mode}')`, () => {
      const ctx = fakeCtx();
      RUN[commandId]!(ctx);
      expect(ctx.openBuild).toHaveBeenCalledWith(mode);
      expect(ctx.handleTileAction).not.toHaveBeenCalled();
    });
  }
});

describe('a second press puts away what the first one chose', () => {
  /** Each surface key, the mode it lands on, and the key that reaches it. */
  const surfaces: Array<[string, 'mountain' | 'water' | 'road']> = [
    ['surface.mountain', 'mountain'],
    ['surface.river', 'water'],
    ['surface.road', 'road'],
  ];

  for (const [commandId, mode] of surfaces) {
    it(`${commandId} pressed on the mode it chose runs the move tile, which is rest`, () => {
      const ctx = fakeCtx();
      useEditorStore.getState().setEditMode({ mode });
      RUN[commandId]!(ctx);
      expect(ctx.handleTileAction).toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
    });

    it(`${commandId} pressed on ANOTHER mode still chooses its own`, () => {
      const ctx = fakeCtx();
      useEditorStore.getState().setEditMode({ mode: mode === 'mountain' ? 'water' : 'mountain' });
      RUN[commandId]!(ctx);
      expect(ctx.handleTileAction).not.toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
    });
  }

  it('app.generate is one of the mode blocks and toggles like the rest', () => {
    const ctx = fakeCtx();
    useEditorStore.getState().setEditMode({ mode: 'generate' });
    RUN['app.generate']!(ctx);
    expect(ctx.handleTileAction).toHaveBeenCalledWith(ACTION_BY_ID.get('move'));
  });

  /**
   * A TOOL LEAVES ITS SURFACE STANDING, which is the whole difference from a mode. `tool: 'none'`
   * is the state `resolveEditMode` already has for it: the map on the hand, the mode untouched, and
   * the shape kept so picking the same cell back up gives the figure it was laying.
   */
  const tools: Array<[string, DesignMode]> = [
    ['tool.brush', 'brush'],
    ['tool.eraser', 'eraser'],
    ['tool.rect', 'rect'],
    ['tool.circle', 'circle'],
    ['tool.line', 'line'],
    ['tool.curve', 'curve'],
    ['tool.edgecut', 'edge-cut'],
  ];

  for (const [commandId, design] of tools) {
    it(`${commandId} pressed on the tool it armed puts it away and keeps the surface`, () => {
      const ctx = fakeCtx();
      const s = useEditorStore.getState();
      // On the surface with NOTHING armed, which is where the row's own second press leaves it.
      s.setEditMode({ mode: 'water', tool: 'none' });
      RUN[commandId]!(ctx);
      // The first press only reaches the SHELL, which is what arms the tool; stand in for it here,
      // through the same mode -> inputs step every shell's `openBuild` runs.
      expect(ctx.openBuild).toHaveBeenCalledWith(design);
      s.setEditMode(designModeToEditInputs(design));
      expect(useEditorStore.getState().designMode).toBe(design);

      const second = fakeCtx();
      RUN[commandId]!(second);
      expect(second.openBuild).not.toHaveBeenCalled();
      const after = useEditorStore.getState();
      expect(after.editMode.tool).toBe('none');
      expect(after.editMode.mode).toBe('water');
      expect(after.designMode).toBe('hand');
    });
  }

  it('the shape a put-away tool was laying survives, so picking it up gives the same figure', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'mountain', tool: 'shape', shape: 'circle' });
    RUN['tool.circle']!(fakeCtx());
    expect(useEditorStore.getState().editMode.shape).toBe('circle');
  });
});

describe('the smart-build key reaches the cell, and only while one is showing', () => {
  it('presses whatever cell is mounted', () => {
    const pressed = vi.fn();
    const withdraw = offerSmartBuild(pressed);
    RUN['tool.smart']!(fakeCtx());
    expect(pressed).toHaveBeenCalledOnce();
    withdraw();
  });

  it('does nothing with no tool row on screen', () => {
    expect(() => RUN['tool.smart']!(fakeCtx())).not.toThrow();
  });
});

describe('RUN dispatches the menu shortcut to toggleMenu, not a tile action', () => {
  it("app.menu -> toggleMenu()", () => {
    const ctx = fakeCtx();
    RUN['app.menu']!(ctx);
    expect(ctx.toggleMenu).toHaveBeenCalledOnce();
    expect(ctx.handleTileAction).not.toHaveBeenCalled();
    expect(ctx.openBuild).not.toHaveBeenCalled();
  });
});
