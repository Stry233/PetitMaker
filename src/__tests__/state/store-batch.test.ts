import { describe, it, expect, beforeEach } from 'vitest';
import { batchStore, useEditorStore } from '../../state/store';

const store = () => useEditorStore.getState();

beforeEach(() => useEditorStore.setState({ gridMode: 'off', tourRunning: false }));

/** Counts store updates published while `body` runs. */
function updatesDuring(body: () => void): number {
  let updates = 0;
  const off = useEditorStore.subscribe(() => { updates++; });
  try {
    body();
  } finally {
    off();
  }
  return updates;
}

describe('batchStore', () => {
  it('publishes every write of its body as one update that readers inside the body already see', () => {
    const updates = updatesDuring(() => batchStore(() => {
      store().setGridMode('auto');
      expect(store().gridMode).toBe('auto');
      batchStore(() => store().setTourRunning(true));
    }));
    expect(updates).toBe(1);
    expect(store()).toMatchObject({ gridMode: 'auto', tourRunning: true });
  });

  it('publishes nothing when its body throws', () => {
    const updates = updatesDuring(() => {
      expect(() => batchStore(() => { store().setGridMode('auto'); throw new Error('stop'); })).toThrow('stop');
    });
    expect(updates).toBe(0);
    expect(store().gridMode).toBe('off');
  });

  it('publishes nothing when its body writes nothing', () => {
    expect(updatesDuring(() => batchStore(() => store().clearSelection()))).toBe(0);
  });
});
