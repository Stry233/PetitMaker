import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';

describe('store: tile surface', () => {
  beforeEach(() => {
    useEditorStore.getState().setContentType('mountain');
    useEditorStore.getState().setTileMaterial('dirt');
  });

  it('defaults tileMaterial to dirt', () => {
    expect(useEditorStore.getState().tileMaterial).toBe('dirt');
  });

  it('accepts tile as a content type', () => {
    useEditorStore.getState().setContentType('tile');
    expect(useEditorStore.getState().contentType).toBe('tile');
  });

  it('switches tile material', () => {
    useEditorStore.getState().setTileMaterial('stone');
    expect(useEditorStore.getState().tileMaterial).toBe('stone');
  });
});
