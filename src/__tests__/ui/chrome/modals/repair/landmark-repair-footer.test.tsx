// @vitest-environment jsdom
/**
 * The landmark repair's footer is Change Planet's: Export first at the start, then Cancel and the
 * repair. Export first asks the export notice, downloads the file as it was opened and leaves the
 * choice open over the untouched map; Cancel still brings everything back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';

const downloads = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock('../../../../../io/export/download', async (actual) => ({
  ...await actual<typeof import('../../../../../io/export/download')>(),
  downloadBlob: (blob: Blob, name: string) => { downloads.push({ blob, name }); },
}));
// The notice's own reading time is its test's; here it is accepted at once, and each ask is counted.
const asked = vi.hoisted(() => ({ formats: [] as string[] }));
vi.mock('../../../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: (_open: boolean, _revision: unknown, _map: unknown, format: string) => ({
    request: () => { asked.formats.push(format); return Promise.resolve(true); },
    notice: null,
  }),
}));

import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { inspectImportFile } from '../../../../../io/import/file';
import { commitImport } from '../../../../../editor/session/import-flow';
import { cancelRepair, installRepairWatch } from '../../../../../editor/session/landmark-repair';
import { newMap } from '../../../../../editor/operations';
import { editorPort } from '../../../../../editor/session/context';
import { LandmarkRepairWindow } from '../../../../../ui/chrome/modals/repair/LandmarkRepairWindow';
import { installPictureRenderer } from '../../../../_support/picture-renderer';

vi.setConfig({ testTimeout: 60_000 });

const FILE = join(__dirname, '..', '..', '..', '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');
const store = () => useEditorStore.getState();

let pictures: ReturnType<typeof installPictureRenderer>;
let stopWatch: () => void = () => {};
beforeEach(() => {
  newMap(editorPort, 'hexia');
  stopWatch = installRepairWatch();
  pictures = installPictureRenderer();
});
afterEach(() => {
  cleanup();
  downloads.length = 0;
  asked.formats.length = 0;
  if (store().repairSession) cancelRepair();
  stopWatch();
  pictures.uninstall();
});

async function askRepair(): Promise<Blob> {
  const blob = new Blob([gunzipSync(readFileSync(FILE)).toString('utf8')], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'hexia.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'hexia.json', file: blob });
  return blob;
}

describe('the landmark repair footer', () => {
  it('reads Export first, Cancel, then the repair, left to right', async () => {
    await askRepair();
    const { baseElement } = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
    const exportFirst = within(baseElement).getByTestId('repair-export-first');
    const footer = exportFirst.closest('div')!.parentElement!;
    const labels = [...footer.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Export first', 'Cancel', 'Repair automatically']);
  });

  it('downloads the opened file itself after the notice and keeps the choice open over the open map', async () => {
    const open = store().gridState;
    const depth = store().commandExecutor!.historyDepth();
    const file = await askRepair();
    const { baseElement } = render(<I18nProvider><LandmarkRepairWindow /></I18nProvider>);
    await act(async () => { fireEvent.click(within(baseElement).getByTestId('repair-export-first')); });
    expect(asked.formats).toEqual(['json']);
    expect(downloads).toEqual([{ blob: file, name: 'hexia.json' }]);
    expect(store().repairSession?.phase).toBe('choose');
    expect(within(baseElement).getByTestId('landmark-repair')).toBeTruthy();
    expect(store().gridState).toBe(open);
    expect(store().commandExecutor!.historyDepth()).toBe(depth);

    fireEvent.click(within(baseElement).getByText('Cancel'));
    expect(store().repairSession).toBeNull();
    expect(store().gridState).toBe(open);
  });
});
