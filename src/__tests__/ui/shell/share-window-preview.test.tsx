/** The share picture in the save-and-share window survives trips to the other sections: the hidden friend panel answers to its own settling, never to the section on screen. */
vi.mock('../../../ui/chrome/modals/export/review/use-map-review', () => ({ useMapReview: () => ({ result: { status: 'clear' }, pending: false, previewReady: true, revision: '0', check: async () => ({ status: 'clear' }), retry: vi.fn(), cancel: vi.fn() }) }));
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { makeState } from '../../rules/_helpers';
import { ShareWindow } from '../../../ui/shell/windows/ShareWindow';

vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: vi.fn(async () => true), notice: null }),
}));
vi.mock('../../../io/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../io/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('../../../io/share/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/share/export')>();
  const { encodeGlyph } = await import('../../../io/share/glyph/encode');
  const { moduleBaseFor } = await import('../../../io/share/glyph/geometry');
  return {
    ...actual,
    buildShareCode: vi.fn(async (_state, _summary, _meta, availableWidth: number) => {
      const moduleBase = moduleBaseFor(availableWidth);
      if (moduleBase === null) return null;
      return { ...encodeGlyph(new Uint8Array(32), moduleBase)!, payloadLen: 32, shareOriginalRecommended: false };
    }),
  };
});
vi.mock('../../../ui/chrome/modals/export/render-preview-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ui/chrome/modals/export/render-preview-bridge')>();
  const canvas = () => Object.assign(document.createElement('canvas'), { width: 40, height: 30 });
  return {
    ...actual,
    captureBaseMap: vi.fn(async () => ({ canvas: canvas() })),
    captureCard3dAngles: vi.fn(async () => []),
    paintPreview: vi.fn(() => canvas()),
  };
});
vi.mock('../../../ui/chrome/modals/export/brand', () => ({ loadBrandLockup: async () => null }));
vi.mock('../../../kit/host', () => ({
  host: { capture2d: vi.fn(() => null), capture2dRegionCanvas: vi.fn(() => null), capture2dTextureCap: () => 16384, camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { buildShareCode } from '../../../io/share/export';
import { captureBaseMap } from '../../../ui/chrome/modals/export/render-preview-bridge';

const picture = () => document.querySelector('canvas[data-export-preview]');
const tab = (name: string) => screen.getByRole('button', { name });

/** Every capture, paint and share-code build has run: the friend section's picture stands. */
async function settled(): Promise<void> {
  await waitFor(() => expect(picture()).not.toBeNull(), { timeout: 3000 });
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  localStorage.clear();
  const state = makeState(8, 8);
  const executor = new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
  act(() => { useEditorStore.setState({ locale: 'en', gridState: state, commandExecutor: executor }); });
});
afterEach(() => {
  act(() => { for (const id of ['share', 'export', 'exportJson'] as const) useEditorStore.getState().setModal(id, false); });
  cleanup();
  MotionGlobalConfig.skipAnimations = false;
  vi.mocked(buildShareCode).mockClear();
  vi.mocked(captureBaseMap).mockClear();
});

/** A trip away to a section reached for the first time, then back to the friend section. */
async function tripAway(to: string): Promise<void> {
  const captures = vi.mocked(captureBaseMap).mock.calls.length;
  const builds = vi.mocked(buildShareCode).mock.calls.length;
  fireEvent.click(tab(to));
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  fireEvent.click(tab('For a friend'));
  expect(picture(), 'the picture stands from the first frame of the return').not.toBeNull();
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  expect(picture()).not.toBeNull();
  expect(vi.mocked(captureBaseMap).mock.calls.length, 'no recapture').toBe(captures);
  expect(vi.mocked(buildShareCode).mock.calls.length, 'no share-code rebuild').toBe(builds);
}

describe('the share picture across sections', () => {
  it('keeps the picture when an opener lands on For a friend and the reader visits Keep working', async () => {
    render(<I18nProvider><ShareWindow /></I18nProvider>);
    act(() => { useEditorStore.getState().setModal('export', true); });
    await settled();
    await tripAway('Keep working');
  });

  it('keeps the picture when the reader goes Keep working, For a friend, then Into the game for the first time', async () => {
    render(<I18nProvider><ShareWindow /></I18nProvider>);
    act(() => { useEditorStore.getState().setModal('share', true); });
    await screen.findByRole('dialog', { name: 'Save and share' });
    fireEvent.click(tab('For a friend'));
    await settled();
    await tripAway('Into the game');
  });
});
