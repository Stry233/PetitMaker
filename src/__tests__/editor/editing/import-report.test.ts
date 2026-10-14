// Pins the toast order for each import outcome. The JSON and raster paths toast in different
// orders (dropped-sections before success for JSON; success before drift warnings for raster), and
// the Import modal and the drag-drop overlay must both keep showing exactly that.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const showToastMock = vi.fn();
vi.mock('../../../platform/channels/toast-bus', () => ({ showToast: (...args: unknown[]) => showToastMock(...args) }));

import { reportImport } from '../../../editor/editing/import-report';
import { setStoreState } from '../../_support/store';

describe('reportImport', () => {
  beforeEach(() => {
    showToastMock.mockClear();
    setStoreState({ locale: 'en' });
  });

  it('JSON import: dropped sections, then success, then the modified caution last', () => {
    reportImport({
      status: 'imported',
      source: 'json',
      warnings: [{ kind: 'dropped-section', section: 'history' }, { kind: 'modified-after-export' }],
    });
    expect(showToastMock.mock.calls.map((c) => c[0])).toEqual([
      "Couldn't restore the history section from this file",
      'Map imported',
      'This file was edited after it was exported. It loaded, but may not match the original.',
    ]);
    expect(showToastMock.mock.calls[2]?.[1]).toBe('error');
  });

  it('JSON import with no warnings: only the success toast', () => {
    reportImport({ status: 'imported', source: 'json', warnings: [] });
    expect(showToastMock.mock.calls.map((c) => c[0])).toEqual(['Map imported']);
  });

  it('raster import: success first, then its drift warnings', () => {
    reportImport({
      status: 'imported',
      source: 'raster',
      warnings: [{ kind: 'template-drift' }, { kind: 'catalog-drift' }],
    });
    expect(showToastMock.mock.calls.map((c) => c[0])).toEqual([
      'Map imported',
      'Imported with a slightly different map template',
      'Imported with a slightly different object set',
    ]);
  });

  it('unsupported: one generic failure toast', () => {
    reportImport({ status: 'unsupported' });
    expect(showToastMock.mock.calls).toEqual([['Could not import a map from this image', 'error']]);
  });

  it('failed with an import error code: maps to its specific message', () => {
    reportImport({ status: 'failed', code: 'future-version' });
    expect(showToastMock.mock.calls).toEqual([['This map was saved by a newer version. Please update to import it', 'error']]);
  });

  it('failed with no code: the generic message', () => {
    reportImport({ status: 'failed' });
    expect(showToastMock.mock.calls).toEqual([['Could not import a map from this image', 'error']]);
  });
});
