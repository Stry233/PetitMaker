// @vitest-environment jsdom
/** The picture panel's two ways to a preset, its tabs and the rebuild switch, choose the same
 *  picture, also where choosing a preset sets the picture's parts, as the offline edition's does. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../editor/review/edition-review', async (original) => ({
  ...await original<typeof import('../../../../../editor/review/edition-review')>(),
  applyExportPreset: (await import('../../../../../editor/review/edition-review-lite')).applyExportPreset,
}));

import { I18nProvider, translate } from '../../../../../i18n/context';
import { ExportControls } from '../../../../../ui/chrome/modals/export/ExportControls';
import type { ExportOptions } from '../../../../../io/export/types';
import { DEFAULT_EXPORT_OPTIONS } from '../../../../../io/export/options-store';

/** The options each control hands back when pressed on `options`. */
function pressed(options: ExportOptions, press: () => void): ExportOptions {
  const setOptions = vi.fn();
  const { unmount } = render(
    <I18nProvider>
      <ExportControls options={options} setOptions={setOptions} notes={{}} setNotes={vi.fn()} summary={null} footerSamples={{}} />
    </I18nProvider>,
  );
  press();
  unmount();
  expect(setOptions).toHaveBeenCalledTimes(1);
  return setOptions.mock.calls[0]![0] as ExportOptions;
}

const rebuildSwitch = () => screen.getByRole('switch', { name: translate('export.importable') });

describe('the picture panel\'s preset controls', () => {
  it('switching rebuilding off chooses the picture the Plain Image tab chooses', () => {
    const share: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, preset: 'share', layerPreview: true, grid: true, footer: true };
    const byTab = pressed(share, () => fireEvent.click(screen.getByText(translate('export.preset_plain'))));
    const bySwitch = pressed(share, () => fireEvent.click(rebuildSwitch()));
    expect(byTab).toMatchObject({ preset: 'plain', layerPreview: false, grid: false, footer: false });
    expect(bySwitch).toEqual(byTab);
  });

  it('switching rebuilding on chooses the picture the share tab chooses', () => {
    const plain: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, preset: 'plain', layerPreview: false, grid: false, footer: false };
    const byTab = pressed(plain, () => fireEvent.click(screen.getByText(translate('export.preset_share'))));
    expect(pressed(plain, () => fireEvent.click(rebuildSwitch()))).toEqual(byTab);
    expect(byTab).toMatchObject({ preset: 'share', layerPreview: true, grid: true, footer: true });
  });
});
