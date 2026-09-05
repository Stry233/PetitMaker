/**
 * What a press means, as a table.
 *
 * The pointer machine executes this plan and the cursor reads it, so every row here is a promise
 * the two make together: what the press does, what a tap then does, and what a drag then does.
 */
import { describe, it, expect } from 'vitest';
import { ToolType } from '../../core/model/types';
import {
  resolvePress, resolveNavTap, cursorFactsFor, armedPressSelects, type PressFacts, type PressIntent,
} from '../../core/interaction/press-plan';

const ARMED = 'tree-apple';

const facts = (over: Partial<PressFacts> = {}): PressFacts => ({
  button: 0,
  tool: ToolType.Hand,
  armedItemId: null,
  selection: [],
  selectingRegion: false,
  toolGrabs: false,
  toolSelects: false,
  toolSelectHit: null,
  clickOnlyStroke: false,
  panDragHeld: false,
  multiSelectHeld: false,
  macro: { x: 4, y: 5 },
  hit: null,
  placementAllowed: true,
  pendingGesture: false,
  viewPansLeftDrag: true,
  ...over,
});

const kinds = (intents: readonly PressIntent[]): string[] => intents.map((i) => i.kind);

describe('resolvePress: the camera always wins', () => {
  it('pans while the pan-drag key is held, whatever the tool', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, panDragHeld: true }));
    expect(kinds(p.down)).toEqual(['pan-camera']);
    expect(kinds(p.onDrag)).toEqual(['pan-camera']);
    // The SOURCE is what the machine keys its two pan states off: a pan-key pan outlives a
    // release the window never saw, a left-drag pan does not.
    expect(p.down[0]).toEqual({ kind: 'pan-camera', by: 'machine', source: 'pan-key' });
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
    // The press falls through to the tool, so the drag still pans, exactly as it does over ground.
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });

  it('selects the terrain cell under a press on bare ground', () => {
    const p = resolvePress(facts());
    expect(p.down[0]).toEqual({ kind: 'select', block: { kind: 'terrain', x: 4, y: 5 } });
  });

  it('deselects the terrain cell that is already selected', () => {
    const p = resolvePress(facts({ selection: [{ kind: 'terrain', x: 4, y: 5 }] }));
    expect(kinds(p.onTap)).toEqual(['deselect']);
    expect(kinds(p.down)).toEqual(['tool-stroke']);
  });
});

describe('resolvePress: the multi-select modifier', () => {
  it('toggles membership and arms the band, never a move', () => {
    const p = resolvePress(facts({
      multiSelectHeld: true,
      selection: [{ kind: 'object', id: 'house' }],
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual(['toggle-select']);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('leaves the selection alone over bare ground and only arms the band', () => {
    const p = resolvePress(facts({ multiSelectHeld: true }));
    expect(kinds(p.down)).toEqual([]);
    expect(kinds(p.onDrag)).toEqual(['band-select']);
  });

  it('reaches the selection path from a build brush, and leaves the brush behind', () => {
    const p = resolvePress(facts({
      tool: ToolType.TerrainBrush,
      multiSelectHeld: true,
      hit: { id: 'house', draggable: true, locked: false },
    }));
    expect(kinds(p.down)).toEqual(['toggle-select']);
    expect(p.leaveBrush).toBe(true);
  });

  it('stays on the build brush for a Ctrl press that writes nothing', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, multiSelectHeld: true }));
    expect(kinds(p.down)).toEqual([]);
    expect(p.leaveBrush).toBe(false);
  });

  it('does not reach the selection path from a build brush unmodified', () => {
    const p = resolvePress(facts({ tool: ToolType.TerrainBrush, hit: { id: 'house', draggable: true, locked: false } }));
    expect(kinds(p.down)).toEqual(['tool-stroke']);
    expect(p.leaveBrush).toBe(false);
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

describe('resolvePress: who pans a left drag', () => {
  it('hands the pan to the view where the view pans its own left drag', () => {
    const p = resolvePress(facts({ tool: ToolType.Hand, viewPansLeftDrag: true }));
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', by: 'tool', source: 'left-drag' }]);
  });

  it('pans from the machine where the view does not', () => {
    const p = resolvePress(facts({ tool: ToolType.Hand, viewPansLeftDrag: false }));
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', by: 'machine', source: 'left-drag' }]);
  });

  it('does not pan an idle placer drag on a view that reserves left for its tools', () => {
    const p = resolvePress(facts({ tool: ToolType.ObjectPlacer, viewPansLeftDrag: true }));
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
    // Even in select mode, where a nav tap would otherwise open the context menu: the pending
    // gesture wins outright, it does not merely go first.
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

describe('armedPressSelects', () => {
  const hit = { id: 'a', draggable: true, locked: false };

  it('only fires for an armed placer, unmodified, over an object, where the placement is refused', () => {
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(true);
    // A LEGAL placement wins: this is what keeps coating over a road, and a bridge/ramp snapping
    // from a decorated anchor cell, placing exactly as before.
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: true,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit: null, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, multiSelectHeld: true, hit, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, selectingRegion: true, hit, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: null, hit, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.Hand, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.TerrainBrush, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(false);
  });

  it('lets a LOCKED object through to the placer, so the refusal is heard', () => {
    // The point of selecting-instead-of-placing is an ad-hoc rotate or delete, and V-LOCK-02
    // refuses both on a locked object. Swallowing the press there took the placement's own
    // refusal with it, which is why clicking the plaza with an item armed did nothing at all.
    const plaza = { id: 'plaza', draggable: false, locked: true };
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit: plaza, placementAllowed: false,
    }))).toBe(false);
    expect(armedPressSelects(facts({
      tool: ToolType.ObjectPlacer, armedItemId: ARMED, hit, placementAllowed: false,
    }))).toBe(true);
  });
});

describe('the cursor promises a grab only where the press would pick something up', () => {
  it('offers no grab over a selected object while an item is armed', () => {
    // An armed placer is not a selecting mode, so a drag here places rather than moves — scanning
    // the selection alone cannot see the armed item, and would promise a grab that never happens.
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
    expect(p.onDrag).toEqual([{ kind: 'pan-camera', by: 'machine', source: 'left-drag' }]);
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
