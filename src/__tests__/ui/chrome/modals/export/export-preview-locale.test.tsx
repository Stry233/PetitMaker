// @vitest-environment jsdom
/** The preview's map capture carries the AI tag in the interface language, so a language change
 *  while the window is open captures the map again with the new tag. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const capture = vi.hoisted(() => vi.fn((..._args: unknown[]) => new Promise<null>(() => {})));
vi.mock('../../../../../editor/export/preview', () => ({
  captureBaseMap: capture,
  loadBrandLockup: async () => null,
  captureCard3dAngles: vi.fn(() => new Promise(() => {})),
  paintPreview: vi.fn(),
}));

import { I18nProvider, translateFor } from '../../../../../i18n/context';
import { ExportPreview } from '../../../../../ui/chrome/modals/export/ExportPreview';
import { useEditorStore } from '../../../../../state/store';
import { createGridState } from '../../../../../core/model/template';
import { getMapTemplate } from '../../../../../config/maps';
import { DEFAULT_FOOTER } from '../../../../../io/export/footer-template';
import type { ExportOptions } from '../../../../../io/export/types';

const opts: ExportOptions = {
  title: '', description: '', preset: 'share', showBadge: false, layerPreview: false,
  card3d: false, grid: true, annotations: true, footer: false, footerTemplate: DEFAULT_FOOTER, resolution: 'standard',
};

afterEach(() => { cleanup(); capture.mockClear(); });

describe('the export preview capture', () => {
  it('captures again with the AI tag in the new language', () => {
    act(() => { useEditorStore.setState({ gridState: createGridState(getMapTemplate('hexia')), locale: 'en' }); });
    render(<I18nProvider><ExportPreview open options={opts} summary={null} /></I18nProvider>);
    expect(capture.mock.calls.at(-1)?.[3]).toBe(translateFor('en', 'export.ai_tag'));
    act(() => { useEditorStore.setState({ locale: 'zh' }); });
    expect(capture.mock.calls.at(-1)?.[3]).toBe(translateFor('zh', 'export.ai_tag'));
  });
});
