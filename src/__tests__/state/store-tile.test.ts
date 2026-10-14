import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { activeToolOf, armedMacroOf, buildToolOf, contentTypeOf } from '../../state/editing/edit-mode';
import { ToolType } from '../../state/editing/vocabulary';
import { getRoadMaterials } from '../../state/catalog';
import { isSurfacePrint } from '../../core/model/traits';

describe('store: tile surface', () => {
  beforeEach(() => {
    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    useEditorStore.getState().setTileMaterial('path-overgrown-dirt');
  });

  it('defaults tileMaterial to the dirt path catalog id', () => {
    expect(useEditorStore.getState().tileMaterial).toBe('path-overgrown-dirt');
  });

  it('accepts tile as a content type', () => {
    useEditorStore.getState().setEditMode({ mode: 'road' });
    expect(contentTypeOf(useEditorStore.getState())).toBe('road');
  });

  it('switches tile material', () => {
    useEditorStore.getState().setTileMaterial('path-garden-stone');
    expect(useEditorStore.getState().tileMaterial).toBe('path-garden-stone');
  });
});

describe('store: a print material puts down the road tools it lacks', () => {
  const s = useEditorStore.getState;
  const print = (): string => getRoadMaterials(true).find((m) => isSurfacePrint(m))!.id;

  beforeEach(() => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    s().setTileMaterial('path-overgrown-dirt');
  });

  it('demotes an armed trim to the brush the bar shows', () => {
    s().setEditMode({ mode: 'road', arm: { kind: 'trim' } });
    expect(activeToolOf(s())).toBe(ToolType.EdgeCut);
    s().setTileMaterial(print());
    expect(buildToolOf(s())).toBe('brush');
    expect(activeToolOf(s())).toBe(ToolType.TerrainBrush);
  });

  it('demotes an armed smart build to the brush the bar shows', () => {
    s().setEditMode({ mode: 'road', arm: { kind: 'smart', macro: 'road-link' } });
    expect(activeToolOf(s())).toBe(ToolType.Macro);
    s().setTileMaterial(print());
    expect(buildToolOf(s())).toBe('brush');
    expect(activeToolOf(s())).toBe(ToolType.TerrainBrush);
    expect(armedMacroOf(s())).toBeNull();
  });

  it('publishes the material and the demoted tool as one update', () => {
    s().setEditMode({ mode: 'road', arm: { kind: 'trim' } });
    const seen: ToolType[] = [];
    const stop = useEditorStore.subscribe((state) => { seen.push(activeToolOf(state)); });
    s().setTileMaterial(print());
    stop();
    expect(seen).toEqual([ToolType.TerrainBrush]);
  });
});
