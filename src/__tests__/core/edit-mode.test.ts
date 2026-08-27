/**
 * One fact — what the user is building and how — resolves to the four fields the tool layer reads,
 * so those four cannot disagree with each other.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveEditMode, nextEditMode, contentArming, REST_INPUTS,
  DESIGN_MODE_TOOL, designModeToToolType, designModeToEditInputs,
  type EditModePatch,
} from '../../core/model/edit-mode';

/** The shelf's memory, which `resolveEditMode` never reads. */
const NONE = { kind: 'none' } as const;
import { ToolType, type DesignMode } from '../../core/model/types';

describe('resolveEditMode', () => {
  it('rests with the hand tool and nothing armed', () => {
    const s = resolveEditMode({ mode: null, arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.Hand);
    expect(s.designMode).toBe('hand');
    expect(s.armedItem).toBeNull();
  });

  it('maps a shape tool to its design mode, keeping the content type', () => {
    const s = resolveEditMode({ mode: 'mountain', arming: { kind: 'shape', shape: 'circle' }, tool: 'shape', shape: 'circle', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.TerrainBrush);
    expect(s.designMode).toBe('circle');
    expect(s.contentType).toBe('mountain');
  });

  it('maps the free brush to the brush design mode', () => {
    expect(resolveEditMode({ mode: 'water', arming: { kind: 'brush' }, tool: 'brush', shape: 'rect', heldObject: NONE }).designMode).toBe('brush');
  });

  it('routes erase and trim to their own tools whatever the content', () => {
    expect(resolveEditMode({ mode: 'road', arming: { kind: 'erase' }, tool: 'erase', shape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Eraser);
    expect(resolveEditMode({ mode: 'road', arming: { kind: 'trim' }, tool: 'trim', shape: 'free', heldObject: NONE }).toolType).toBe(ToolType.EdgeCut);
  });

  it('arms an item only in object mode', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, tool: 'brush', shape: 'free', heldObject: NONE }).armedItem).toBe('tree-apple');
    expect(resolveEditMode({ mode: 'mountain', arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: NONE }).armedItem).toBeNull();
  });

  it('places objects with the placer tool', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, tool: 'brush', shape: 'free', heldObject: NONE }).toolType).toBe(ToolType.ObjectPlacer);
  });

  it('rests in object mode with no item picked: there is nothing to place', () => {
    expect(resolveEditMode({ mode: 'object', arming: { kind: 'none' }, tool: 'brush', shape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Hand);
  });

  it('rests in generate mode: the map is not being painted', () => {
    expect(resolveEditMode({ mode: 'generate', arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: NONE }).toolType).toBe(ToolType.Hand);
  });

  it('leaving the brush for a selection keeps the surface', () => {
    const s = resolveEditMode({ mode: 'water', arming: { kind: 'none' }, tool: 'none', shape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.Hand);
    expect(s.designMode).toBe('hand');
    expect(s.contentType).toBe('water');
  });

  it("'none' is a content-surface concept only: object mode reads itemId, not tool", () => {
    const s = resolveEditMode({ mode: 'object', arming: { kind: 'item', itemId: 'tree-apple' }, tool: 'none', shape: 'free', heldObject: NONE });
    expect(s.toolType).toBe(ToolType.ObjectPlacer);
    expect(s.armedItem).toBe('tree-apple');
  });
});

/**
 * `designModeToToolType` and `resolveEditMode`'s own toolType output must never disagree. SEPARATE
 * mode→tool tables (one in the UI, one inlined in resolveEditMode) let a change to a mode's tool in
 * one leave the other on a stale answer with nothing to catch it, so both read `DESIGN_MODE_TOOL`.
 */
describe('the mode→tool mapping has one source', () => {
  const modes = Object.keys(DESIGN_MODE_TOOL) as DesignMode[];

  it("designModeToEditInputs round-trips through resolveEditMode's own tool/shape -> mode step", () => {
    for (const mode of modes) {
      const inputs = designModeToEditInputs(mode);
      const s = resolveEditMode({
        mode: 'mountain',
        arming: contentArming(inputs.tool, inputs.shape ?? 'free'),
        tool: inputs.tool,
        shape: inputs.shape ?? 'free',
        heldObject: NONE,
      });
      expect(s.designMode).toBe(mode);
    }
  });

  it("resolveEditMode's toolType for a shape/erase/trim mode matches designModeToToolType of the designMode it reports", () => {
    const cases: Parameters<typeof resolveEditMode>[0][] = [
      { mode: 'mountain', arming: { kind: 'shape', shape: 'circle' }, tool: 'shape', shape: 'circle', heldObject: NONE },
      { mode: 'water', arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: NONE },
      { mode: 'road', arming: { kind: 'erase' }, tool: 'erase', shape: 'free', heldObject: NONE },
      { mode: 'road', arming: { kind: 'trim' }, tool: 'trim', shape: 'free', heldObject: NONE },
      { mode: null, arming: { kind: 'brush' }, tool: 'brush', shape: 'free', heldObject: NONE },
    ];
    for (const inputs of cases) {
      const s = resolveEditMode(inputs);
      expect(s.toolType).toBe(designModeToToolType(s.designMode));
    }
  });
});

describe('nextEditMode: what this call arms outranks what was carried', () => {
  const rest = REST_INPUTS;
  const arm = (...patches: EditModePatch[]) => patches.reduce(nextEditMode, rest);

  it('a card outranks an eraser carried in from another surface', () => {
    const s = arm({ mode: 'water', tool: 'erase' }, { mode: 'object', itemId: 'bridge-teak' });
    expect(s.arming).toEqual({ kind: 'item', itemId: 'bridge-teak' });
  });

  it('a carried eraser does not follow the user into the shelf', () => {
    expect(arm({ mode: 'water', tool: 'erase' }, { mode: 'object' }).arming).toEqual({ kind: 'none' });
  });

  it('but the shelf still arms the eraser when it is asked for there', () => {
    expect(arm({ mode: 'object' }, { tool: 'erase' }).arming).toEqual({ kind: 'erase' });
  });

  it('a planting card outranks the same carried eraser', () => {
    const s = arm({ mode: 'water', tool: 'erase' }, { mode: 'object', macro: 'patch-tree' });
    expect(s.arming).toEqual({ kind: 'macro', macro: 'patch-tree' });
  });

  it('asking for a tool puts the armed card down, and it does not come back', () => {
    const s = arm({ mode: 'object', itemId: 'bridge-teak' }, { tool: 'erase' }, { tool: 'brush' });
    expect(s.arming).toEqual({ kind: 'none' });
  });

  it('a surface keeps its tool across a change of surface', () => {
    expect(arm({ mode: 'water', tool: 'brush' }, { mode: 'road' }).arming).toEqual({ kind: 'brush' });
  });

  it('a macro belongs to the surface it was armed on', () => {
    expect(arm({ mode: 'mountain', tool: 'smart', macro: 'raise' }, { mode: 'water' }).arming)
      .toEqual({ kind: 'none' });
  });

  it('the figure survives putting the shape tool away', () => {
    const s = arm({ mode: 'mountain', tool: 'shape', shape: 'circle' }, { tool: 'none' });
    expect(s.arming).toEqual({ kind: 'none' });
    expect(s.shape).toBe('circle');
  });

  it('rest is a pause: the surface resumes with what it held', () => {
    const s = arm({ mode: 'mountain', tool: 'trim' }, { mode: null }, { mode: 'mountain' });
    expect(s.arming).toEqual({ kind: 'trim' });
  });
});

describe('nextEditMode: the shelf remembers its card across a trip to a surface', () => {
  const arm = (...patches: EditModePatch[]) => patches.reduce(nextEditMode, REST_INPUTS);

  it('a card armed before sculpting is armed again on return', () => {
    const s = arm(
      { mode: 'object', itemId: 'ramp-wood-simple' },
      { mode: 'mountain', tool: 'brush' },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'item', itemId: 'ramp-wood-simple' });
  });

  it('the memory survives a trip across several surfaces', () => {
    const s = arm(
      { mode: 'object', macro: 'patch-tree' },
      { mode: 'mountain', tool: 'brush' },
      { mode: 'water', tool: 'erase' },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'macro', macro: 'patch-tree' });
  });

  it('the first visit still arms nothing: there is nothing to resume', () => {
    expect(arm({ mode: 'mountain', tool: 'brush' }, { mode: 'object' }).arming).toEqual({ kind: 'none' });
  });

  it('an ask on the way in outranks the memory', () => {
    const s = arm(
      { mode: 'object', itemId: 'ramp-wood-simple' },
      { mode: 'water', tool: 'brush' },
      { mode: 'object', itemId: 'bridge-teak' },
    );
    expect(s.arming).toEqual({ kind: 'item', itemId: 'bridge-teak' });
  });

  it('a card put down before leaving stays down on return', () => {
    const s = arm(
      { mode: 'object', itemId: 'ramp-wood-simple' },
      { itemId: null },
      { mode: 'road', tool: 'brush' },
      { mode: 'object' },
    );
    expect(s.arming).toEqual({ kind: 'none' });
  });
});
