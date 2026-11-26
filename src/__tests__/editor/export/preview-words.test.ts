// @vitest-environment jsdom
/** The words a preview of the share picture paints: the ones it is handed, with an image import's
 *  own standing over them, or none. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributionUnits } from '../../../state/notes-attribution';
import { TerrainType, type MapNotes } from '../../../core/model/types';
import { makeState, setTerrain } from '../../_support/map-state';
import { stubCanvasContext } from '../../_support/canvas-context';
import { paintPreview } from '../../../editor/export/preview';
import { DEFAULT_EXPORT_OPTIONS } from '../../../io/export/options-store';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';

vi.mock('../../../io/export/paint', () => ({ paintComposition: vi.fn() }));
vi.mock('../../../io/export/composition-assets', async (orig) => {
  const real = await orig<typeof import('../../../io/export/composition-assets')>();
  return { ...real, compositionAssets: vi.fn(real.compositionAssets) };
});
import { compositionAssets } from '../../../io/export/composition-assets';

let canvas: ReturnType<typeof stubCanvasContext>;
beforeEach(() => { canvas = stubCanvasContext({ scale: () => {} }); vi.mocked(compositionAssets).mockClear(); });
afterEach(() => { canvas.mockRestore(); });

/** Paints a preview of an image import whose own words were `imported`, handed `words`, and
 *  returns the options the picture was composed with. */
function painted(words: MapNotes | null, imported: MapNotes = { title: 'Harbour town' }) {
  const state = makeState(8, 8);
  setTerrain(state, 2, 2, TerrainType.Mountain, 1);
  state.imageAttribution = { version: 1, templateId: state.template.id, notes: imported, units: attributionUnits(state) };
  const baseMap = Object.assign(document.createElement('canvas'), { width: 200, height: 200 });
  const options = { ...DEFAULT_EXPORT_OPTIONS, footerTemplate: 'By River' };
  expect(paintPreview({ options, words, summary: null, state, locale: 'en', baseMap, card3dAngles: [], site: 'https://example.test' })).not.toBeNull();
  return vi.mocked(compositionAssets).mock.calls.at(-1)![0].options;
}

describe('paintPreview', () => {
  it('keeps an image import\'s own words over the ones it is handed', () => {
    expect(painted({})).toMatchObject({ title: 'Harbour town', description: '', footerTemplate: 'By River' });
    expect(painted({ title: 'Mine now', description: 'Added later' })).toMatchObject({ title: 'Harbour town', description: 'Added later' });
  });

  it('paints no title, description or typed footer when it is handed no words', () => {
    expect(painted(null)).toMatchObject({ title: '', description: '', footerTemplate: DEFAULT_FOOTER });
  });
});
