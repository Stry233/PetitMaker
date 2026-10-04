/** An edition that reads no planet files and no videos treats both as files it cannot import, as it always has. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

vi.mock('../../../core/runtime/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../core/runtime/edition')>()),
  SUPPORTS_JSON_FILES: false,
  SUPPORTS_VIDEO_IMPORT: false,
}));

import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { newMap } from '../../../kit/operations/map';
import { writePlanetFile } from '../../../io/planet-codec';
import { classifyImportFile } from '../../../io/import-kind';
import { DropImportOverlay } from '../../../ui/chrome/modals/import/DropImportOverlay';
import { planetFixture } from '../../fixtures/planet';

const planetFile = () => new File([writePlanetFile('Bay', planetFixture())], 'Bay.planet.json', { type: 'application/json' });
const videoFile = () => new File([new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], 'scan.mp4', { type: 'video/mp4' });

beforeEach(() => { act(() => { newMap('hexia'); useEditorStore.setState({ locale: 'en', handedImport: null }); }); });
afterEach(() => { cleanup(); });

describe('planet files and videos without planet import', () => {
  it('classifies both as unknown and keeps image share codes as maps', async () => {
    expect(await classifyImportFile(planetFile())).toBe('unknown');
    expect(await classifyImportFile(videoFile())).toBe('unknown');
    expect(await classifyImportFile(new File([], 'share.png', { type: 'image/png' }))).toBe('map');
  });

  it('refuses a dropped video with the map import message and no redirect card', async () => {
    const toasts: string[] = [];
    const stop = setToastPresenter((text) => toasts.push(text));
    try {
      render(<MotionConfig reducedMotion="always"><I18nProvider><DropImportOverlay /></I18nProvider></MotionConfig>);
      const e = (type: string) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files: [videoFile()] } });
      act(() => { window.dispatchEvent(e('dragenter')); window.dispatchEvent(e('drop')); });
      await waitFor(() => expect(toasts).toContain(translate('import.fail_generic')));
      expect(screen.queryByTestId('import-redirect')).toBeNull();
      expect(useEditorStore.getState().handedImport).toBeNull();
      expect(useEditorStore.getState().modals.newProject).toBe(false);
    } finally {
      stop();
    }
  });
});
