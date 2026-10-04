import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../state/store';

const store = () => useEditorStore.getState();
const file = new File(['x'], 'scan.mp4', { type: 'video/mp4' });

beforeEach(() => {
  useEditorStore.setState({ handedImport: null });
  for (const id of ['import', 'newProject', 'planetImport'] as const) store().setModal(id, false);
});

describe('handing a file to the window that reads it', () => {
  it('opens Import planet over Change Planet for a video and closes Import map', () => {
    store().setModal('import', true);
    store().handImport({ kind: 'video', file });
    expect(store().modals).toMatchObject({ import: false, newProject: true, planetImport: true });
  });

  it('opens Change Planet alone for a planet file and Import map alone for a map', () => {
    store().handImport({ kind: 'planet', file });
    expect(store().modals).toMatchObject({ import: false, newProject: true, planetImport: false });
    store().handImport({ kind: 'map', file });
    expect(store().modals).toMatchObject({ import: true, newProject: false, planetImport: false });
  });

  it('gives the file once, and only to a reader of its kind', () => {
    store().handImport({ kind: 'video', file });
    expect(store().takeHandedImport('planet')).toBeNull();
    expect(store().takeHandedImport('video')).toBe(file);
    expect(store().takeHandedImport('video')).toBeNull();
    expect(store().handedImport).toBeNull();
  });
});
