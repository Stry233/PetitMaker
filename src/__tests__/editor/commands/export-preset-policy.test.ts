/** A preset set through the command door is the edition's preset: where choosing one also sets the
 *  picture's parts, as the offline edition's does, the command sets them too. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../editor/review/edition-review', async (original) => ({
  ...await original<typeof import('../../../editor/review/edition-review')>(),
  applyExportPreset: (await import('../../../editor/review/edition-review-lite')).applyExportPreset,
}));

import { runCommand } from '../../../editor/commands/run';
import { openingExportOptions } from '../../../io/export/options-store';
import { removePref } from '../../../platform/storage/prefs';
import { createDefaultRegistry } from '../../../rules';
import { MODAL_IDS } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { makeTemplate } from '../../_support/map-state';

const s = () => useEditorStore.getState();
const run = async (args: Record<string, unknown>) => {
  expect(await runCommand('app.export_image', args), JSON.stringify(args)).toMatchObject({ ok: true });
  return openingExportOptions();
};

beforeEach(() => { s().initMap(makeTemplate(30, 30), createDefaultRegistry()); });
afterEach(() => {
  for (const id of MODAL_IDS) s().setModal(id, false);
  removePref('exportOptions');
});

describe('app.export_image under an edition whose preset sets the picture\'s parts', () => {
  it('sets the parts with the preset, as the preset tabs do', async () => {
    expect(await run({ preset: 'plain' })).toMatchObject({ preset: 'plain', layerPreview: false, grid: false, footer: false, card3d: false });
    expect(await run({ preset: 'share' })).toMatchObject({ preset: 'share', layerPreview: true, grid: true, footer: true, card3d: false });
  });

  it('keeps a part the same call names over the preset\'s own choice', async () => {
    expect(await run({ preset: 'plain', grid: true })).toMatchObject({ preset: 'plain', layerPreview: false, grid: true, footer: false });
  });
});
