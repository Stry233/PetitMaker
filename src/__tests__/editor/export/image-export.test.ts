// @vitest-environment jsdom
/** The share picture's words through its verb: they are the map's own, whatever options a caller
 *  hands over, and an image import's title and description stay on its picture. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { attributionUnits } from '../../../state/notes-attribution';
import { TerrainType, type GridState, type MapNotes } from '../../../core/model/types';
import { makeState, setTerrain } from '../../_support/map-state';
import { resetStore, setStoreState } from '../../_support/store';
import { exportImage, openingExportOptions } from '../../../editor/export/image-export';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import type { MapReview } from '../../../editor/review/map-review';
import type { ReviewResult, TextPart } from '../../../editor/review/text-review';

vi.mock('../../../io/export/run-image-export', () => ({
  runImageExport: vi.fn(async () => ({ status: 'done', blob: new Blob(['png']), carriesCode: false })),
}));
vi.mock('../../../io/export/download', async (orig) => ({ ...(await orig<typeof import('../../../io/export/download')>()), downloadBlob: vi.fn() }));
import { runImageExport } from '../../../io/export/run-image-export';
import { downloadBlob } from '../../../io/export/download';

function hooks() {
  return {
    signal: new AbortController().signal,
    checkMap: vi.fn(async () => ({ status: 'clear' }) as MapReview),
    checkText: vi.fn(async (_parts: TextPart[]) => ({ allowed: true }) as ReviewResult),
    begin: vi.fn(async () => {}),
    reviewing: vi.fn(),
    progress: vi.fn(),
    confirmNotice: vi.fn(async () => true),
  };
}

/** Opens a map with `notes`; with `imported`, as an image import whose own words those were. */
function openMap(notes: MapNotes, imported?: MapNotes): GridState {
  const state = makeState(8, 8);
  setTerrain(state, 2, 2, TerrainType.Mountain, 1);
  state.notes = notes;
  if (imported) state.imageAttribution = { version: 1, templateId: state.template.id, notes: imported, units: attributionUnits(state) };
  setStoreState({ gridState: state, commandExecutor: createExecutor(state, createDefaultRegistry()), locale: 'en', exportedAt: null });
  return state;
}

/** Exports with the options a window opens on, which carry no words, and returns the options the picture was composed with. */
async function exported(withoutText = false) {
  const h = hooks();
  const outcome = await exportImage({ options: openingExportOptions(), withoutText, previewCode: null, site: 'https://example.test' }, h);
  const composed = vi.mocked(runImageExport).mock.calls.map(([, input]) => input.options);
  return { outcome, composed, checked: h.checkText.mock.calls.flatMap(([parts]) => parts) };
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
  vi.mocked(runImageExport).mockClear();
  vi.mocked(downloadBlob).mockClear();
});

describe('exportImage', () => {
  it('[FILE-27] keeps an image import\'s title and description on the picture, whatever a caller\'s options say', async () => {
    openMap({}, { title: 'Harbour town', description: 'By its first maker' });
    const { outcome, composed, checked } = await exported();
    expect(outcome.status).toBe('done');
    expect(composed).toHaveLength(1);
    expect(composed[0]).toMatchObject({ title: 'Harbour town', description: 'By its first maker' });
    expect(checked).toEqual(expect.arrayContaining([{ field: 'title', text: 'Harbour town' }, { field: 'description', text: 'By its first maker' }]));
    expect(downloadBlob).toHaveBeenCalledOnce();
  });

  it('draws the map\'s own title and description for a caller that hands over none', async () => {
    openMap({ title: 'Orchard', description: 'Apples by the river' });
    const { composed, checked } = await exported();
    expect(composed[0]).toMatchObject({ title: 'Orchard', description: 'Apples by the river' });
    expect(checked).toEqual(expect.arrayContaining([{ field: 'title', text: 'Orchard' }]));
  });

  it('leaves the words out only when asked to, and never on an image import that keeps its own', async () => {
    openMap({ title: 'Orchard', description: 'Apples by the river' });
    const plain = await exported(true);
    expect(plain.composed[0]).toMatchObject({ title: '', description: '', footerTemplate: DEFAULT_FOOTER });
    expect(plain.checked).toEqual([]);

    vi.mocked(runImageExport).mockClear();
    openMap({}, { title: 'Harbour town' });
    const held = await exported(true);
    expect(held.outcome.status).toBe('stopped');
    expect(held.composed).toHaveLength(0);
  });
});
