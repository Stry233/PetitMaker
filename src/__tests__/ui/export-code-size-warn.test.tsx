import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, translate } from '../../i18n/context';
import { ExportControls } from '../../ui/chrome/export/ExportControls';
import type { ExportOptions } from '../../io/export/types';
import { DEFAULT_FOOTER } from '../../io/export/footer-template';

const opts = (over: Partial<ExportOptions>): ExportOptions => ({
  title: '', description: '', preset: 'share', importable: true, showBadge: false, layerPreview: false,
  card3d: false, grid: true, footer: false, footerTemplate: DEFAULT_FOOTER, resolution: 'standard', ...over,
});

function renderControls(options: ExportOptions) {
  return render(
    <I18nProvider>
      <ExportControls options={options} setOptions={vi.fn()} summary={null} footerSamples={{}} />
    </I18nProvider>,
  );
}

const WARN = translate('export.code_size_warn');

// The note lives in an always-mounted Expand (grid collapse), inert when closed. It's "shown" only
// when its Expand wrapper is not inert.
function warnShown(): boolean {
  const el = screen.queryByText(WARN);
  return !!el && el.closest('[inert]') === null;
}

describe('ExportControls — share-code size warning', () => {
  it('warns when an importable export is set to a size too small for the code (compact)', () => {
    renderControls(opts({ importable: true, resolution: 'compact' }));
    expect(warnShown()).toBe(true);
  });

  it('does not warn at a size that fits the code (standard)', () => {
    renderControls(opts({ importable: true, resolution: 'standard' }));
    expect(warnShown()).toBe(false);
  });

  it('does not warn on a compact NON-importable export (no code expected anyway)', () => {
    renderControls(opts({ importable: false, resolution: 'compact' }));
    expect(warnShown()).toBe(false);
  });
});
