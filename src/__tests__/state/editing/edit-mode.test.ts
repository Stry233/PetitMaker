/**
 * One fact, what the user is building and how, resolves through the store's selectors to the fields
 * the tool layer reads, so those cannot disagree with each other.
 */
import { describe, it, expect } from 'vitest';
import {
  activeToolOf, armedItemOf, buildShapeOf, buildToolOf, armedMacroOf, contentTypeOf, designModeOf, nextEditMode, REST_INPUTS,
  designModeArming, isDrawingMode,
  type EditModeChange, type EditModeInputs,
} from '../../../state/editing/edit-mode';

/** What `inputs` resolve to, read through the store's selectors. */
function resolveEditMode(inputs: EditModeInputs) {
  const s = { editMode: inputs };
  return { toolType: activeToolOf(s), designMode: designModeOf(s), contentType: contentTypeOf(s), armedItem: armedItemOf(s), armedMacro: armedMacroOf(s) };
}

/** The shelf's memory, which resolution never reads. */
const NONE = { kind: 'none' } as const;
import { ToolType, type DesignMode } from '../../../state/editing/vocabulary';

describe('resolveEditMode', () => {
  it('rests with the hand tool and nothing armed', () => {
    const s = resolveEditMode({ mode: null, arming: { kind: 'brush' }, heldShape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.Hand);
    expect(s.designMode).toBe('none');
    expect(s.armedItem).toBeNull();
  });

  it('maps a shape tool to its design mode, keeping the content type', () => {
    const s = resolveEditMode({ mode: 'mountain', arming: { kind: 'shape', shape: 'circle' }, heldShape: 'circle', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.TerrainBrush);
    expect(s.designMode).toBe('circle');
    expect(s.contentType).toBe('mountain');
  });

  it('maps the free brush to the free design mode', () => {
    expect(resolveEditMode({ mode: 'water', arming: { kind: 'brush' }, heldShape: 'rect', heldObject: NONE }).designMode).toBe('free');
  });

  it('routes erase and trim to their own tools whatever the content', () => {
    expect(resolveEditMode({ mode: 'road', arming: { kind: 'erase' }, heldShape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Eraser);
    expect(resolveEditMode({ mode: 'road', arming: { kind: 'trim' }, heldShape: 'free', heldObject: NONE }).toolType).toBe(ToolType.EdgeCut);
  });

  it('arms an item only in object mode', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, heldShape: 'free', heldObject: NONE }).armedItem).toBe('tree-apple');
    expect(resolveEditMode({ mode: 'mountain', arming: { kind: 'brush' }, heldShape: 'free', heldObject: NONE }).armedItem).toBeNull();
  });

  it('places objects with the placer tool', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, heldShape: 'free', heldObject: NONE }).toolType).toBe(ToolType.ObjectPlacer);
  });

  it('rests in object mode with no item picked: there is nothing to place', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'none' }, heldShape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Hand);
  });

  it('rests in generate mode: the map is not being painted', () => {
    expect(resolveEditMode({ mode: 'generate', arming: { kind: 'brush' }, heldShape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Hand);
  });

  it('leaving the brush for a selection keeps the surface', () => {
    const s = resolveEditMode({ mode: 'water', arming: { kind: 'none' }, heldShape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.Hand);
    expect(s.designMode).toBe('none');
    expect(s.contentType).toBe('water');
  });

  it("'none' is a content-surface concept only: object mode reads itemId, not tool", () => {
    const s = resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, heldShape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.ObjectPlacer);
    expect(s.armedItem).toBe('tree-apple');
  });
});

const DESIGN_MODES: readonly DesignMode[] = ['free', 'line', 'curve', 'rect', 'circle', 'erase', 'trim', 'none'];

describe('a drawing mode has one arming and one tool', () => {
  it('designModeArming round-trips through resolution', () => {
    for (const mode of DESIGN_MODES) {
      const s = resolveEditMode(nextEditMode(REST_INPUTS, { mode: 'mountain', arm: designModeArming(mode) }));
      expect(s.designMode).toBe(mode);
    }
  });

  it('every figure is drawn by the terrain brush, and the others by their own tools', () => {
    const toolOf = (mode: DesignMode) => resolveEditMode(nextEditMode(REST_INPUTS, { mode: 'road', arm: designModeArming(mode) })).toolType;
    for (const mode of DESIGN_MODES.filter(isDrawingMode)) expect(toolOf(mode)).toBe(ToolType.TerrainBrush);
    expect(toolOf('erase')).toBe(ToolType.Eraser);
    expect(toolOf('trim')).toBe(ToolType.EdgeCut);
    expect(toolOf('none')).toBe(ToolType.Hand);
  });
});

describe('nextEditMode: an arming of the other family is translated', () => {
  it("a surface's smart tool becomes the shelf's planting card, and back", () => {
    const shelf = nextEditMode(REST_INPUTS, { mode: 'object', arm: { kind: 'smart', macro: 'patch-tree' } });
    expect(shelf.arming).toEqual({ kind: 'macro', macro: 'patch-tree' });
    const road = nextEditMode(REST_INPUTS, { mode: 'road', arm: { kind: 'macro', macro: 'road-link' } });
    expect(road.arming).toEqual({ kind: 'smart', macro: 'road-link' });
  });

  it('a brush asked for on the shelf arms nothing, and an item card asked for on a surface changes nothing', () => {
    expect(nextEditMode(REST_INPUTS, { mode: 'object', arm: { kind: 'trim' } }).arming).toEqual({ kind: 'none' });
    const there = nextEditMode(REST_INPUTS, { mode: 'water', arm: { kind: 'erase' } });
    expect(nextEditMode(there, { arm: { kind: 'item', itemId: 'tree-apple' } }).arming).toEqual({ kind: 'erase' });
  });
});

describe('nextEditMode: what this call arms outranks what was carried', () => {
  const rest = REST_INPUTS;
  const arm = (...patches: EditModeChange[]) => patches.reduce(nextEditMode, rest);

  it('a card outranks an eraser carried in from another surface', () => {
    const s = arm({ mode: 'water', arm: { kind: 'erase' } }, { mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } });
    expect(s.arming).toEqual({ kind: 'item', itemId: 'bridge-teak' });
  });

  it('a carried eraser does not follow the user into the shelf', () => {
    expect(arm({ mode: 'water', arm: { kind: 'erase' } }, { mode: 'object' }).arming).toEqual({ kind: 'none' });
  });

  it('but the shelf still arms the eraser when it is asked for there', () => {
    expect(arm({ mode: 'object' }, { arm: { kind: 'erase' } }).arming).toEqual({ kind: 'erase' });
  });

  it('a planting card outranks the same carried eraser', () => {
    const s = arm({ mode: 'water', arm: { kind: 'erase' } }, { mode: 'object', arm: { kind: 'macro', macro: 'patch-tree' } });
    expect(s.arming).toEqual({ kind: 'macro', macro: 'patch-tree' });
  });

  it('asking for a tool puts the armed card down, and it does not come back', () => {
    const s = arm({ mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } }, { arm: { kind: 'erase' } }, { arm: { kind: 'brush' } });
    expect(s.arming).toEqual({ kind: 'none' });
  });

  it('a surface keeps its tool across a change of surface', () => {
    expect(arm({ mode: 'water', arm: { kind: 'brush' } }, { mode: 'road' }).arming).toEqual({ kind: 'brush' });
  });

  it('a macro belongs to the surface it was armed on', () => {
    expect(arm({ mode: 'mountain', arm: { kind: 'smart', macro: 'raise' } }, { mode: 'water' }).arming)
      .toEqual({ kind: 'none' });
  });

  it('the figure survives putting the shape tool away', () => {
    const s = arm({ mode: 'mountain', arm: { kind: 'shape', shape: 'circle' } }, { arm: { kind: 'none' } });
    expect(s.arming).toEqual({ kind: 'none' });
    expect(buildShapeOf({ editMode: s })).toBe('circle');
  });

  it('rest is a pause: the surface resumes with what it held', () => {
    const s = arm({ mode: 'mountain', arm: { kind: 'trim' } }, { mode: null }, { mode: 'mountain' });
    expect(s.arming).toEqual({ kind: 'trim' });
  });
});

describe('nextEditMode: the shelf remembers its card across a trip to a surface', () => {
  const arm = (...patches: EditModeChange[]) => patches.reduce(nextEditMode, REST_INPUTS);

  it('a card armed before sculpting is armed again on return', () => {
    const s = arm(
      { mode: 'object', arm: { kind: 'item', itemId: 'ramp-wood-simple' } },
      { mode: 'mountain', arm: { kind: 'brush' } },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'item', itemId: 'ramp-wood-simple' });
  });

  it('the memory survives a trip across several surfaces', () => {
    const s = arm(
      { mode: 'object', arm: { kind: 'macro', macro: 'patch-tree' } },
      { mode: 'mountain', arm: { kind: 'brush' } },
      { mode: 'water', arm: { kind: 'erase' } },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'macro', macro: 'patch-tree' });
  });

  it('the first visit still arms nothing: there is nothing to resume', () => {
    expect(arm({ mode: 'mountain', arm: { kind: 'brush' } }, { mode: 'object' }).arming).toEqual({ kind: 'none' });
  });

  it('an ask on the way in outranks the memory', () => {
    const s = arm(
      { mode: 'object', arm: { kind: 'item', itemId: 'ramp-wood-simple' } },
      { mode: 'water', arm: { kind: 'brush' } },
      { mode: 'object', arm: { kind: 'item', itemId: 'bridge-teak' } },
    );
    expect(s.arming).toEqual({ kind: 'item', itemId: 'bridge-teak' });
  });

  it('a card put down before leaving stays down on return', () => {
    const s = arm(
      { mode: 'object', arm: { kind: 'item', itemId: 'ramp-wood-simple' } },
      { arm: { kind: 'none' } },
      { mode: 'road', arm: { kind: 'brush' } },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'none' });
  });
});

describe('the annotate mode', () => {
  it('resolves to the annotate tool with nothing armed on the map', () => {
    const inputs = nextEditMode(REST_INPUTS, { mode: 'annotate' });
    const s = resolveEditMode(inputs);
    expect(s.toolType).toBe(ToolType.Annotate);
    expect(s.armedItem).toBeNull();
    expect(s.armedMacro).toBeNull();
  });

  it('carries the surface arming through, so leaving and returning resumes the brush held before', () => {
    const there = nextEditMode(REST_INPUTS, { mode: 'mountain', arm: { kind: 'shape', shape: 'circle' } });
    const away = nextEditMode(there, { mode: 'annotate' });
    const back = nextEditMode(away, { mode: 'mountain' });
    expect(back.arming).toEqual({ kind: 'shape', shape: 'circle' });
  });
});

it('selects the freehand shape when returning from an object to the free brush', () => {
  let mode = nextEditMode(REST_INPUTS, { mode: 'mountain', arm: { kind: 'shape', shape: 'rect' } });
  mode = nextEditMode(mode, { mode: 'object', arm: { kind: 'item', itemId: 'tree-apple' } });
  mode = nextEditMode(mode, { mode: 'mountain' });
  expect(buildToolOf({ editMode: mode })).toBe('brush');
  expect(buildShapeOf({ editMode: mode })).toBe('free');
});

it('names exactly the design modes the terrain brush draws as drawing modes', () => {
  expect(DESIGN_MODES.filter(isDrawingMode).sort()).toEqual(['circle', 'curve', 'free', 'line', 'rect']);
});
