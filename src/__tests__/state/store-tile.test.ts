import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';

describe('store: tile surface', () => {
  beforeEach(() => {
    useEditorStore.getState().setEditMode({ mode: 'mountain', tool: 'brush' });
    useEditorStore.getState().setTileMaterial('road-dirt');
  });

  it('defaults tileMaterial to the dirt road catalog id', () => {
    expect(useEditorStore.getState().tileMaterial).toBe('road-dirt');
  });

  it('accepts tile as a content type', () => {
    useEditorStore.getState().setEditMode({ mode: 'road' });
    expect(useEditorStore.getState().contentType).toBe('tile');
  });

  it('switches tile material', () => {
    useEditorStore.getState().setTileMaterial('road-stone');
    expect(useEditorStore.getState().tileMaterial).toBe('road-stone');
  });
});
