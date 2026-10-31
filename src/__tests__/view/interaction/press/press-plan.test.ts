/**
 * What a press means, as a table: what the press, a following tap and a following drag do. The
 * pointer machine executes this plan and the cursor reads it.
 */
import { describe, it, expect } from 'vitest';
import { ToolType } from '../../../../state/editing/vocabulary';
import type { BlockRef } from '../../../../state/selection';
import { toolDeclares } from '../../../../tools/pointer/runtime';
import type { ToolArming } from '../../../../state/editing/arming';
import {
  resolvePress, resolveNavTap, cursorFactsFor, type PressFacts, type PressIntent,
} from '../../../../view/interaction/press/press-plan';

const ARMED = 'tree-apple';

/** A row's facts. `tool` names the active tool, whose own hooks answer `selectMode` and `brush`. */
const facts = ({ tool = ToolType.Hand, ...over }: Partial<PressFacts> & { tool?: ToolType } = {}): PressFacts => {
  const declared = toolDeclares(tool);
  return {
    button: 0,
    inputMode: 'pc',
    selectMode: declared.selectMode({ armedItem: over.armedItemId ?? null } as ToolArming),
    brush: declared.brush,
    armedItemId: null,
    copyHeld: false,
    selection: [],
    selectingRegion: false,
    toolGrabs: false,
    toolSelects: false,
    toolSelectHit: null,
    clickOnlyStroke: false,
    armedStrokes: false,
    panDragHeld: false,
    multiSelectHeld: false,
    moveLatched: false,
    macro: { x: 4, y: 5 },
    // Apart from `macro` on purpose: a terrain selection names the terrain cell, never the placement cell.
    terrain: { x: 7, y: 8 },
    // Mountain or water unless a row picks: a press on open ground picks the placement cell instead.
    pick: null,
    hit: null,
    placementAllowed: true,
    pendingGesture: false,
    ...over,
  };
};

const kinds = (intents: readonly PressIntent[]): string[] => intents.map((i) => i.kind);

describe('resolvePress: the camera always wins', () => {
  it('pans while the pan-drag key is held, whatever the tool', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, panDragHeld: true }));
    expect(kinds(p.down)).toEqual(['pan-camera']);
    expect(kinds(p.onDrag)).toEqual(['pan-camera']);
    // The machine keys its two pan states off the source: a pan-key pan outlives a release the
    // window never saw, a left-drag pan does not.
    expect(p.down[0]).toEqual({ kind: 'pan-camera', source: 'pan-key' });
  });

  it('paints the region before any tool or selection sees the press', () => {
    const p = resolvePress(facts({ tool: ToolType.Hand, selectingRegion: true, hit: { id: 'a', draggable: true, locked: false } }));
    expect(kinds(p.down)).toEqual(['paint-region']);
  });
});

describe('resolvePress: selecting', () => {
  it('selects an unselected object and lets the drag pan', () => {
    const p = resolvePress(facts({ hit: { id: 'house', draggable: true, locked: false } }));
    expect(kinds(p.down)).toEqual(['select', 'tool-stroke']);
    expect(kinds(p.onDrag)).toEqual(['pan-camera']);
  });

  it('picks up an object that is already selected', () => {
    const p = resolvePress(facts({
      selection: [{ kind: 'object', id: 'house' }],
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual([]);
    expect(kinds(p.onDrag)).toEqual(['move-selection']);
    expect(kinds(p.onTap)).toEqual(['deselect']);
  });

  it('carries the whole group when the press lands on any member', () => {
    const p = resolvePress(facts({
      selection: [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'b' }],
      hit: { id: 'b', draggable: true, locked: false },
    }));
    expect(p.onDrag).toEqual([{ kind: 'move-selection', anchorId: 'b' }]);
    expect(p.onTap).toEqual([{ kind: 'collapse-select', id: 'b' }]);
  });

  it('refuses to pick up an object that cannot be moved', () => {
    const p = resolvePress(facts({
      selection: [{ kind: 'object', id: 'plaza' }],
      hit: { id: 'plaza', draggable: false, locked: true },
    }));
    expect(p.onDrag.some((i) => i.kind === 'move-selection')).toBe(false);
    expect(kinds(p.onTap)).toEqual(['deselect']);
    // The press falls through to the tool, so the drag pans as it does over ground.
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });

  it('[EDIT-25] selects the terrain cell under a press on mountain or water, picking the placement cell under it', () => {
    const p = resolvePress(facts());
    expect(p.down[0]).toEqual({ kind: 'select', block: { kind: 'terrain', x: 7, y: 8 }, pick: { x: 4, y: 5 } });
  });

  it('[EDIT-54] picks the placement cell under a press on open ground, selecting no terrain', () => {
    const p = resolvePress(facts({ pick: { x: 4, y: 5 }, selection: [{ kind: 'terrain', x: 7, y: 8 }] }));
    expect(p.down[0]).toEqual({ kind: 'pick-cell', cell: { x: 4, y: 5 } });
    expect(resolveNavTap(facts({ pick: { x: 4, y: 5 } }))).toContainEqual({ kind: 'pick-cell', cell: { x: 4, y: 5 } });
  });

  it('deselects the terrain cell that is already selected', () => {
    const p = resolvePress(facts({ selection: [{ kind: 'terrain', x: 7, y: 8 }] }));
    expect(kinds(p.onTap)).toEqual(['deselect']);
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });
});

describe('resolvePress: the multi-select modifier', () => {
  it('toggles membership and arms the band over an object outside the selection, never a move', () => {
    const p = resolvePress(facts({
      multiSelectHeld: true,
      selection: [{ kind: 'object', id: 'tree' }],
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual(['toggle-select']);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('[EDIT-60] over a selected member, waits: a tap toggles it on release and a drag copies the selection', () => {
    const p = resolvePress(facts({
      multiSelectHeld: true,
      selection: [{ kind: 'object', id: 'house' }],
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual([]);
    expect(kinds(p.onTap)).toEqual(['toggle-on-release']);
    expect(kinds(p.onDrag)).toEqual(['copy-selection']);
  });

  it('leaves the selection alone over bare ground and only arms the band', () => {
    const p = resolvePress(facts({ multiSelectHeld: true }));
    expect(kinds(p.down)).toEqual([]);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('reaches the selection path from a build brush', () => {
    const p = resolvePress(facts({
      tool: ToolType.TerrainBrush,
      multiSelectHeld: true,
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual(['toggle-select']);
  });

  it('writes nothing for a Ctrl press from a build brush over bare ground', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, multiSelectHeld: true }));
    expect(kinds(p.down)).toEqual([]);
  });

  it('does not reach the selection path from a build brush unmodified', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, hit: { id: 'house', draggable: true, locked: false } }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });
});

describe('resolvePress: an armed item', () => {
  it('places where the placement is legal', () => {
    const p = resolvePress(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED,
      hit: { id: 'house', draggable: true, locked: false }, placementAllowed: true,
    }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });

  it('selects the object in the way where the placement is refused', () => {
    const p = resolvePress(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED,
      hit: { id: 'house', draggable: true, locked: false }, placementAllowed: false,
    }));
    expect(p.down).toEqual([{ kind: 'select', block: { kind: 'object', id: 'house' } }]);
  });

  it('lets a locked object take its own refusal', () => {
    const p = resolvePress(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED,
      hit: { id: 'plaza', draggable: false, locked: true }, placementAllowed: false,
    }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });
});

describe('resolvePress: when a left drag pans', () => {
  it('pans a Hand-tool drag that picks nothing up', () => {
    const p = resolvePress(facts({ tool: ToolType.Hand }));
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('leaves an armed placer drag to the tool', () => {
    const p = resolvePress(facts({ tool: ToolType.ObjectPlacer, armedItemId: ARMED }));
    expect(kinds(p.onDrag)).toEqual([]);
  });
});

describe('resolveNavTap', () => {
  it('selects what it hit and opens the menu on it', () => {
    const t = resolveNavTap(facts({ button: 2, hit: { id: 'house', draggable: true, locked: false } }));
    expect(t).toEqual([
      { kind: 'context-menu', block: { kind: 'object', id: 'house' } },
      { kind: 'select', block: { kind: 'object', id: 'house' } },
    ]);
  });

  it('follows the multi-select rule a left click follows', () => {
    const t = resolveNavTap(facts({
      button: 2, multiSelectHeld: true, hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(t)).toEqual(['context-menu', 'toggle-select']);
  });

  it('leaves the selection untouched over bare ground with the modifier held', () => {
    const t = resolveNavTap(facts({ button: 2, multiSelectHeld: true }));
    expect(kinds(t)).toEqual(['context-menu']);
  });

  it('offers nothing outside the selecting modes', () => {
    expect(resolveNavTap(facts({ button: 2, tool: ToolType.TerrainBrush }))).toEqual([]);
  });

  it('a nav tap ends a pending gesture and does nothing else', () => {
    // Even in select mode, where a nav tap would otherwise open the context menu.
    const t = resolveNavTap(facts({
      button: 2, pendingGesture: true, hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(t).toEqual([{ kind: 'cancel-pending' }]);
  });
});

describe('cursorFactsFor: the cursor reads the plan the press executes', () => {
  it('offers to add an object the modifier would toggle in', () => {
    const c = cursorFactsFor(facts({ multiSelectHeld: true, hit: { id: 'a', draggable: true, locked: false } }));
    expect(c.ctrlHint).toBe('select-add');
  });

  it('offers to remove one that is already a member', () => {
    const c = cursorFactsFor(facts({
      multiSelectHeld: true,
      selection: [{ kind: 'object', id: 'a' }],
      hit: { id: 'a', draggable: true, locked: false },
    }));
    expect(c.ctrlHint).toBe('select-remove');
  });

  it('offers the band over bare ground', () => {
    expect(cursorFactsFor(facts({ multiSelectHeld: true })).ctrlHint).toBe('marquee');
  });

  it('says nothing while the region brush owns the pointer', () => {
    expect(cursorFactsFor(facts({ multiSelectHeld: true, selectingRegion: true })).ctrlHint).toBe(null);
  });

  it('still answers the selection question while the pan-drag key is held', () => {
    const c = cursorFactsFor(facts({
      panDragHeld: true, multiSelectHeld: true, hit: { id: 'a', draggable: true, locked: false },
    }));
    expect(c.ctrlHint).toBe('select-add');
  });

  it('promises a grab exactly where a drag would pick something up', () => {
    const over = cursorFactsFor(facts({
      selection: [{ kind: 'object', id: 'a' }], hit: { id: 'a', draggable: true, locked: false },
    }));
    expect(over.overSelected).toBe(true);
    const locked = cursorFactsFor(facts({
      selection: [{ kind: 'object', id: 'p' }], hit: { id: 'p', draggable: false, locked: true },
    }));
    expect(locked.overSelected).toBe(false);
  });

  it('promises no grab where the press paints, selected object or not', () => {
    const brush = cursorFactsFor(facts({
      tool: ToolType.TerrainBrush, selection: [{ kind: 'object', id: 'a' }], hit: { id: 'a', draggable: true, locked: false },
    }));
    expect(brush.overSelected).toBe(false);
  });

  it('promises a grab where the TOOL owns the pickup (the annotate select state over a note)', () => {
    const grab = cursorFactsFor(facts({ tool: ToolType.Annotate, toolGrabs: true }));
    expect(grab.overSelected).toBe(true);
    // Ctrl toggles membership and never arms the drag, so no grab is promised under it.
    const ctrl = cursorFactsFor(facts({ tool: ToolType.Annotate, toolGrabs: true, multiSelectHeld: true }));
    expect(ctrl.overSelected).toBe(false);
    // Empty ground: nothing to grab, the drag is the camera's.
    const empty = cursorFactsFor(facts({ tool: ToolType.Annotate, toolGrabs: false }));
    expect(empty.overSelected).toBe(false);
  });

  it('promises a select where an armed press would select instead of place', () => {
    const c = cursorFactsFor(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED,
      hit: { id: 'a', draggable: true, locked: false }, placementAllowed: false,
    }));
    expect(c.pressSelects).toBe(true);
  });
});

describe('an armed press that selects instead of placing', () => {
  const hit = { id: 'a', draggable: true, locked: false };
  /** Whether the press selects the object under it, and only that, in place of the placer's stroke. */
  const selectsInstead = (f: PressFacts): boolean => {
    const p = resolvePress(f);
    return f.hit !== null && JSON.stringify(p) === JSON.stringify({ down: [{ kind: 'select', block: { kind: 'object', id: f.hit.id } }], onTap: [], onDrag: [] });
  };

  it('only fires for an armed placer, unmodified, over an object, where the placement is refused', () => {
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(true);
    // A legal placement wins, so coating over a road and a crossing snapping from a decorated
    // anchor cell still place.
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: true,
    }))).toBe(false);
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit: null, placementAllowed: false,
    }))).toBe(false);
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, multiSelectHeld: true, hit, placementAllowed: false,
    }))).toBe(false);
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, selectingRegion: true, hit, placementAllowed: false,
    }))).toBe(false);
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: null, hit, placementAllowed: false,
    }))).toBe(false);
  });

  it('lets a LOCKED object through to the placer, so the refusal is heard', () => {
    // Selecting instead of placing serves a rotate or delete, which V-LOCK-02 refuses on a locked
    // object; swallowing the press would also swallow the placement's refusal.
    const plaza = { id: 'plaza', draggable: false, locked: true };
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit: plaza, placementAllowed: false,
    }))).toBe(false);
    expect(selectsInstead(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(true);
  });
});

describe('the cursor promises a grab only where the press would pick something up', () => {
  it('offers no grab over a selected object while an item is armed', () => {
    // An armed placer is not a selecting mode, so a drag here places rather than moves.
    const c = cursorFactsFor(facts({
      tool: ToolType.ObjectPlacer,
      armedItemId: ARMED,
      selection: [{ kind: 'object', id: 'a' }],
      hit: { id: 'a', draggable: true, locked: false },
      placementAllowed: true,
    }));
    expect(c.overSelected).toBe(false);
  });
});

describe('a click-only stroke leaves the drag to the camera', () => {
  it('the press still strokes, and the drag arms a machine pan instead of dying', () => {
    const p = resolvePress(facts({ tool: ToolType.Annotate, clickOnlyStroke: true }));
    expect(p.down).toEqual([{ kind: 'tool-stroke' }]);
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('a dragging stroke keeps the drag', () => {
    const p = resolvePress(facts({ tool: ToolType.Annotate, clickOnlyStroke: false }));
    expect(p.down).toEqual([{ kind: 'tool-stroke' }]);
    expect(p.onDrag).toEqual([]);
  });
});

describe('a tool-owned select state answers the modifier as the map select mode does', () => {
  const annotate = (over: Partial<PressFacts> = {}): PressFacts =>
    facts({ tool: ToolType.Annotate, toolSelects: true, clickOnlyStroke: true, ...over });

  it('offers selection over an unselected note and a grab over a selected note', () => {
    const unselected = cursorFactsFor(annotate({ toolSelectHit: { id: 'n1', selected: false } }));
    expect(unselected.pressSelects).toBe(true);
    expect(unselected.overSelected).toBe(false);
    const selected = cursorFactsFor(annotate({
      toolSelectHit: { id: 'n1', selected: true }, toolGrabs: true, clickOnlyStroke: false,
    }));
    expect(selected.pressSelects).toBe(false);
    expect(selected.overSelected).toBe(true);
  });

  it('a ctrl press reaches the tool (its own toggle) and the drag is a band, never a pan', () => {
    const p = resolvePress(annotate({ multiSelectHeld: true }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('over a note the band still arms: a press toggles, the drag is what the band means', () => {
    const p = resolvePress(annotate({
      multiSelectHeld: true, clickOnlyStroke: false, toolGrabs: true,
      toolSelectHit: { id: 'n1', selected: false },
    }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('the modifier cursor badges membership through toolSelectHit, and the band elsewhere', () => {
    const add = cursorFactsFor(annotate({
      multiSelectHeld: true, clickOnlyStroke: false, toolGrabs: true,
      toolSelectHit: { id: 'n1', selected: false },
    }));
    expect(add.ctrlHint).toBe('select-add');
    const remove = cursorFactsFor(annotate({
      multiSelectHeld: true, clickOnlyStroke: false, toolGrabs: true,
      toolSelectHit: { id: 'n1', selected: true },
    }));
    expect(remove.ctrlHint).toBe('select-remove');
    expect(cursorFactsFor(annotate({ multiSelectHeld: true })).ctrlHint).toBe('marquee');
    expect(cursorFactsFor(annotate()).ctrlHint).toBeNull();
  });
});

describe('PC plans are identical', () => {
  // Every fact combination the cases above read, resolved as a mouse resolves it. The snapshot was
  // recorded before touch presses had a pending phase, so a PC plan that changes fails here.
  const hit = { id: 'a', draggable: true, locked: false };
  const plaza = { id: 'plaza', draggable: false, locked: true };
  const one = [{ kind: 'object', id: 'a' }] as const;
  const two = [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'b' }] as const;
  const cases: Record<string, Partial<PressFacts> & { tool?: ToolType }> = {
    'hand bare': {},
    'hand hit': { hit },
    'hand hit selected': { hit, selection: [...one] },
    'hand hit in group': { hit, selection: [...two] },
    'hand locked selected': { hit: plaza, selection: [{ kind: 'object', id: 'plaza' }] },
    'hand terrain selected': { selection: [{ kind: 'terrain', x: 7, y: 8 }] },
    'hand ctrl hit': { hit, multiSelectHeld: true },
    'hand ctrl hit selected': { hit, multiSelectHeld: true, selection: [...one] },
    'hand ctrl bare': { multiSelectHeld: true },
    'hand pan key': { panDragHeld: true, hit },
    'hand region': { selectingRegion: true, hit },
    'hand region ctrl': { selectingRegion: true, multiSelectHeld: true },
    'hand pan key ctrl': { panDragHeld: true, multiSelectHeld: true, hit },
    'brush bare': { tool: ToolType.TerrainBrush },
    'brush hit': { tool: ToolType.TerrainBrush, hit },
    'brush hit selected': { tool: ToolType.TerrainBrush, hit, selection: [...one] },
    'brush ctrl hit': { tool: ToolType.TerrainBrush, hit, multiSelectHeld: true },
    'brush ctrl bare': { tool: ToolType.TerrainBrush, multiSelectHeld: true },
    'brush pan key': { tool: ToolType.TerrainBrush, panDragHeld: true },
    'placer unarmed hit': { tool: ToolType.ObjectPlacer, hit },
    'placer unarmed bare': { tool: ToolType.ObjectPlacer },
    'placer armed bare': { tool: ToolType.ObjectPlacer, armedItemId: ARMED },
    'placer armed hit allowed': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: true },
    'placer armed hit refused': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false },
    'placer armed locked refused': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit: plaza, placementAllowed: false },
    'placer armed bare refused': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, placementAllowed: false },
    'placer armed ctrl hit': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, multiSelectHeld: true, placementAllowed: false },
    'placer armed region': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, selectingRegion: true, placementAllowed: false },
    'placer armed selected': { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, selection: [...one] },
    'annotate grab': { tool: ToolType.Annotate, toolGrabs: true },
    'annotate grab ctrl': { tool: ToolType.Annotate, toolGrabs: true, multiSelectHeld: true },
    'annotate click only': { tool: ToolType.Annotate, clickOnlyStroke: true },
    'annotate stroke': { tool: ToolType.Annotate },
    'annotate selects': { tool: ToolType.Annotate, toolSelects: true, clickOnlyStroke: true, toolSelectHit: { id: 'n1', selected: false } },
    'annotate selects grab': { tool: ToolType.Annotate, toolSelects: true, toolGrabs: true, toolSelectHit: { id: 'n1', selected: true } },
    'annotate selects ctrl': { tool: ToolType.Annotate, toolSelects: true, clickOnlyStroke: true, multiSelectHeld: true },
    'annotate selects ctrl hit': { tool: ToolType.Annotate, toolSelects: true, toolGrabs: true, multiSelectHeld: true, toolSelectHit: { id: 'n1', selected: true } },
    'pending gesture hand': { pendingGesture: true, hit },
    'right button hit': { button: 2, hit },
  };
  const line = (name: string, over: Partial<PressFacts> & { tool?: ToolType }): string => {
    const f = facts({ ...over, inputMode: 'pc' });
    const nav = resolveNavTap({ ...f, button: 2 });
    return `${name}: ${JSON.stringify(resolvePress(f))} nav ${JSON.stringify(nav)} cursor ${JSON.stringify(cursorFactsFor(f))}`;
  };

  it('resolves every case exactly as before', () => {
    expect(Object.entries(cases).map(([name, over]) => line(name, over)).join('\n')).toMatchInlineSnapshot(`
      "hand bare: {"down":[{"kind":"select","block":{"kind":"terrain","x":7,"y":8},"pick":{"x":4,"y":5}},{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"terrain","x":7,"y":8}},{"kind":"select","block":{"kind":"terrain","x":7,"y":8},"pick":{"x":4,"y":5}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand hit: {"down":[{"kind":"select","block":{"kind":"object","id":"a"}},{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand hit selected: {"down":[],"onTap":[{"kind":"deselect"}],"onDrag":[{"kind":"move-selection","anchorId":"a"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":true}
      hand hit in group: {"down":[],"onTap":[{"kind":"collapse-select","id":"a"}],"onDrag":[{"kind":"move-selection","anchorId":"a"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":true}
      hand locked selected: {"down":[{"kind":"tool-stroke"}],"onTap":[{"kind":"deselect"}],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"plaza"}},{"kind":"select","block":{"kind":"object","id":"plaza"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand terrain selected: {"down":[{"kind":"tool-stroke"}],"onTap":[{"kind":"deselect"}],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"terrain","x":7,"y":8}},{"kind":"select","block":{"kind":"terrain","x":7,"y":8},"pick":{"x":4,"y":5}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand ctrl hit: {"down":[{"kind":"toggle-select","block":{"kind":"object","id":"a"}}],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"toggle-select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":"select-add","pressSelects":false,"overSelected":false}
      hand ctrl hit selected: {"down":[],"onTap":[{"kind":"toggle-on-release","block":{"kind":"object","id":"a"}}],"onDrag":[{"kind":"copy-selection","anchorId":"a"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"toggle-select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":"select-remove","pressSelects":false,"overSelected":true}
      hand ctrl bare: {"down":[],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [{"kind":"context-menu","block":{"kind":"terrain","x":7,"y":8}}] cursor {"ctrlHint":"marquee","pressSelects":false,"overSelected":false}
      hand pan key: {"down":[{"kind":"pan-camera","source":"pan-key"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"pan-key"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand region: {"down":[{"kind":"paint-region"}],"onTap":[],"onDrag":[{"kind":"paint-region"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand region ctrl: {"down":[{"kind":"paint-region"}],"onTap":[],"onDrag":[{"kind":"paint-region"}]} nav [{"kind":"context-menu","block":{"kind":"terrain","x":7,"y":8}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      hand pan key ctrl: {"down":[{"kind":"pan-camera","source":"pan-key"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"pan-key"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"toggle-select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":"select-add","pressSelects":false,"overSelected":false}
      brush bare: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      brush hit: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      brush hit selected: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      brush ctrl hit: {"down":[{"kind":"toggle-select","block":{"kind":"object","id":"a"}}],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [] cursor {"ctrlHint":"select-add","pressSelects":false,"overSelected":false}
      brush ctrl bare: {"down":[],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [] cursor {"ctrlHint":"marquee","pressSelects":false,"overSelected":false}
      brush pan key: {"down":[{"kind":"pan-camera","source":"pan-key"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"pan-key"}]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer unarmed hit: {"down":[{"kind":"select","block":{"kind":"object","id":"a"}},{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer unarmed bare: {"down":[{"kind":"select","block":{"kind":"terrain","x":7,"y":8},"pick":{"x":4,"y":5}},{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"context-menu","block":{"kind":"terrain","x":7,"y":8}},{"kind":"select","block":{"kind":"terrain","x":7,"y":8},"pick":{"x":4,"y":5}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed bare: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed hit allowed: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed hit refused: {"down":[{"kind":"select","block":{"kind":"object","id":"a"}}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":true,"overSelected":false}
      placer armed locked refused: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed bare refused: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed ctrl hit: {"down":[{"kind":"toggle-select","block":{"kind":"object","id":"a"}}],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [] cursor {"ctrlHint":"select-add","pressSelects":false,"overSelected":false}
      placer armed region: {"down":[{"kind":"paint-region"}],"onTap":[],"onDrag":[{"kind":"paint-region"}]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      placer armed selected: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      annotate grab: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":true}
      annotate grab ctrl: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      annotate click only: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      annotate stroke: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      annotate selects: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [] cursor {"ctrlHint":null,"pressSelects":true,"overSelected":false}
      annotate selects grab: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[]} nav [] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":true}
      annotate selects ctrl: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [] cursor {"ctrlHint":"marquee","pressSelects":false,"overSelected":false}
      annotate selects ctrl hit: {"down":[{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"band-select","from":{"x":4,"y":5}}]} nav [] cursor {"ctrlHint":"select-remove","pressSelects":false,"overSelected":false}
      pending gesture hand: {"down":[{"kind":"select","block":{"kind":"object","id":"a"}},{"kind":"tool-stroke"}],"onTap":[],"onDrag":[{"kind":"pan-camera","source":"left-drag"}]} nav [{"kind":"cancel-pending"}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}
      right button hit: {"down":[],"onTap":[],"onDrag":[]} nav [{"kind":"context-menu","block":{"kind":"object","id":"a"}},{"kind":"select","block":{"kind":"object","id":"a"}}] cursor {"ctrlHint":null,"pressSelects":false,"overSelected":false}"
    `);
  });
});

describe('resolvePress in touch mode', () => {
  const touch = (over: Partial<PressFacts> & { tool?: ToolType } = {}): PressFacts => facts({ ...over, inputMode: 'touch' });
  const hit = { id: 'a', draggable: true, locked: false };
  const objectA = { kind: 'object', id: 'a' } as const;

  it('[EDIT-45] waits, selects an unselected object on the tap, and pans on a drag', () => {
    const p = resolvePress(touch({ hit }));
    expect(p.pending).toBe(true);
    expect(p.down).toEqual([]);
    expect(p.onTap).toEqual([{ kind: 'select', block: objectA }]);
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('[EDIT-45] moves the selection on a drag that starts on it', () => {
    const p = resolvePress(touch({ hit, selection: [objectA] }));
    expect(p.pending).toBe(true);
    expect(p.onTap).toEqual([{ kind: 'deselect' }]);
    expect(p.onDrag).toEqual([{ kind: 'move-selection', anchorId: 'a' }]);
  });

  it('[EDIT-45] pans from a selected object that cannot be moved', () => {
    const p = resolvePress(touch({ hit: { id: 'plaza', draggable: false, locked: true }, selection: [{ kind: 'object', id: 'plaza' }] }));
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('[EDIT-45] selects the terrain cell on a tap over mountain or water', () => {
    const p = resolvePress(touch());
    expect(p.onTap).toEqual([{ kind: 'select', block: { kind: 'terrain', x: 7, y: 8 }, pick: { x: 4, y: 5 } }]);
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('[EDIT-54] picks the placement cell on a tap over open ground, and a drag there still pans', () => {
    const p = resolvePress(touch({ pick: { x: 4, y: 5 } }));
    expect(p.onTap).toEqual([{ kind: 'pick-cell', cell: { x: 4, y: 5 } }]);
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
  });

  it('[EDIT-42] opens the menu on a long press over an object, and offers nothing over bare ground', () => {
    expect(resolvePress(touch({ hit })).onHold).toEqual([{ kind: 'context-menu', block: objectA }]);
    expect(resolvePress(touch()).onHold).toEqual([]);
  });

  it('[EDIT-41] waits with an item armed: a tap places, a drag or a still hold previews', () => {
    const p = resolvePress(touch({ tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit }));
    expect(p.pending).toBe(true);
    expect(p.down).toEqual([]);
    expect(p.onTap).toEqual([{ kind: 'tool-stroke' }]);
    expect(p.onDrag).toEqual([{ kind: 'preview-placement' }]);
    expect(p.onHold).toEqual([{ kind: 'preview-placement' }]);
  });

  it('selects instead of placing on a tap where the placement is refused', () => {
    const p = resolvePress(touch({ tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false }));
    expect(p.onTap).toEqual([{ kind: 'select', block: objectA }]);
  });

  it('[EDIT-23] never holds back a painting stroke: it starts on the finger landing', () => {
    for (const tool of [ToolType.TerrainBrush, ToolType.Eraser, ToolType.Annotate]) {
      const p = resolvePress(touch({ tool }));
      expect(p.pending, tool).toBeFalsy();
      expect(p, tool).toEqual(resolvePress(facts({ tool })));
    }
  });

  it('leaves the pan-drag key, the region brush and an armed item\'s multi-select modifier as a mouse has them', () => {
    const armedCtrl = { tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, multiSelectHeld: true, placementAllowed: false };
    for (const over of [{ panDragHeld: true }, { selectingRegion: true }, armedCtrl]) {
      expect(resolvePress(touch(over))).toEqual(resolvePress(facts(over)));
    }
  });

  it('[EDIT-43] under multi-select a tap toggles what it lands on and a drag from bare map bands', () => {
    const onObject = resolvePress(touch({ hit, multiSelectHeld: true }));
    expect(onObject.pending).toBe(true);
    expect(onObject.down).toEqual([]);
    expect(onObject.onTap).toEqual([{ kind: 'toggle-select', block: objectA }]);
    expect(onObject.onDrag).toEqual([{ kind: 'band-select', from: { x: 4, y: 5 } }]);
    const bare = resolvePress(touch({ multiSelectHeld: true, selection: [objectA] }));
    expect(bare.onTap).toEqual([]);
    expect(bare.onDrag).toEqual([{ kind: 'band-select', from: { x: 4, y: 5 } }]);
    expect(bare.onHold).toEqual([]);
  });

  it('[EDIT-43] under multi-select a drag from a member that can move moves the group', () => {
    const two = [objectA, { kind: 'object', id: 'b' }] as const;
    expect(resolvePress(touch({ hit, multiSelectHeld: true, selection: [...two] })).onDrag)
      .toEqual([{ kind: 'move-selection', anchorId: 'a' }]);
    const locked = { id: 'plaza', draggable: false, locked: true };
    expect(resolvePress(touch({ hit: locked, multiSelectHeld: true, selection: [{ kind: 'object', id: 'plaza' }] })).onDrag)
      .toEqual([{ kind: 'band-select', from: { x: 4, y: 5 } }]);
  });

  it('[EDIT-42] under the move latch a drag from anywhere moves the selection', () => {
    const latched = { moveLatched: true, selection: [{ kind: 'object', id: 'b' }] as BlockRef[] };
    expect(resolvePress(touch(latched)).onDrag).toEqual([{ kind: 'move-selection', anchorId: 'b' }]);
    expect(resolvePress(touch({ ...latched, hit })).onDrag).toEqual([{ kind: 'move-selection', anchorId: 'b' }]);
    expect(resolvePress(touch({ ...latched, multiSelectHeld: true })).onDrag).toEqual([{ kind: 'move-selection', anchorId: 'b' }]);
    expect(resolvePress(touch({ moveLatched: true })).onDrag, 'with nothing selected it pans')
      .toEqual([{ kind: 'pan-camera', source: 'left-drag' }]);
    expect(resolvePress(facts(latched)), 'a mouse ignores it').toEqual(resolvePress(facts({ selection: latched.selection })));
  });
});
