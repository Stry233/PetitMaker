/**
 * When no share code is coming, the export panel says so. Swallowing the encoder's refusal into the
 * console and painting an empty band reads as a rendering fault: a map carrying ten road tiles on one
 * cell shows a blank strip and no explanation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, translate } from '../../../i18n/context';
import { ExportPreview } from '../../../ui/chrome/modals/export/ExportPreview';
import { shareCodeIssueKey } from '../../../ui/chrome/modals/export/use-share-code';
import { createBlankGridState } from '../../../io/share/codec/blank-grid';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import type { ExportOptions } from '../../../io/export/types';
import type { GridState } from '../../../core/model/types';

const opts: ExportOptions = {
  title: '', description: '', preset: 'share', importable: true, showBadge: false, layerPreview: false,
  card3d: false, grid: true, annotations: true, footer: false, footerTemplate: DEFAULT_FOOTER, resolution: 'standard',
};

/** A map with `n` dirt roads stacked on one cell. */
function stacked(n: number): GridState {
  const s = createBlankGridState('hexia');
  for (let i = 0; i < n; i++) {
    s.objects.set(`r${i}`, { id: `r${i}`, catalogId: 'path-overgrown-dirt', position: { x: 29, y: 108 }, rotation: 0, elevation: 0 });
  }
  return s;
}

afterEach(cleanup);

describe('the export preview says when no code is coming', () => {
  it('is silent while a code is on its way', () => {
    render(<I18nProvider><ExportPreview open options={opts} summary={null} codePending /></I18nProvider>);
    expect(screen.queryByText(translate('export.code_overlap'))).toBeNull();
    expect(screen.queryByText(translate('export.code_failed'))).toBeNull();
  });

  it('names the stacked objects when that is what stopped it', () => {
    render(<I18nProvider><ExportPreview open options={opts} summary={null} codeIssue="export.code_overlap" /></I18nProvider>);
    expect(screen.getByText(translate('export.code_overlap'))).toBeTruthy();
  });
});

describe('which line a failure earns', () => {
  it('blames the stack when the map holds one', () => {
    expect(shareCodeIssueKey(stacked(10))).toBe('export.code_overlap');
  });

  it('falls back to the plain line for a map with nothing stacked', () => {
    expect(shareCodeIssueKey(stacked(1))).toBe('export.code_failed');
    expect(shareCodeIssueKey(null)).toBe('export.code_failed');
  });
});
