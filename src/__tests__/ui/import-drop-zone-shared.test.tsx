// SSOT pin: the Import modal and the window-level drag overlay must render the exact SAME
// `ImportDropZone` component, not each their own dashed box. Mocking the module rather than
// asserting on rendered text/colour is what catches a fork: a re-hand-rolled copy would never call
// this mock, and would fail here even while still looking identical.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../i18n/context';
import { makeState } from '../rules/_helpers';

const dropZoneSpy = vi.fn();
vi.mock('../../ui/chrome/import/ImportDropZone', async (importOriginal) => {
  // Keep the real `IMPORT_CARD_WIDTH`/`IMPORT_CARD_PADDING` exports (DropImportOverlay reads them
  // at module scope) — only the component itself is swapped for the spy.
  const actual = await importOriginal<typeof import('../../ui/chrome/import/ImportDropZone')>();
  return {
    ...actual,
    ImportDropZone: (props: Record<string, unknown>) => {
      dropZoneSpy(props);
      return null;
    },
  };
});

import { ImportModal } from '../../ui/chrome/import/ImportModal';
import { DropImportOverlay } from '../../ui/chrome/import/DropImportOverlay';
import { setStoreState } from '../_store';

function Wrapper({ children }: { children: React.ReactNode }) {
  // reducedMotion="always": only the mock call matters here, not animation timing.
  return <MotionConfig reducedMotion="always"><I18nProvider>{children}</I18nProvider></MotionConfig>;
}

function dragEnterWithFile(): void {
  const e = new Event('dragenter', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
  e.dataTransfer = { types: ['Files'], files: [] };
  act(() => { window.dispatchEvent(e); });
}

describe('ImportModal and DropImportOverlay share ImportDropZone', () => {
  beforeEach(() => {
    dropZoneSpy.mockReset();
    setStoreState({ locale: 'en', importModalOpen: false, gridState: makeState() });
  });

  it('ImportModal renders the shared drop zone with click-to-pick wired up', () => {
    setStoreState({ importModalOpen: true });
    render(<ImportModal />, { wrapper: Wrapper });

    expect(dropZoneSpy).toHaveBeenCalled();
    const props = dropZoneSpy.mock.calls[0]?.[0] as { onClick?: () => void; dragOver: boolean; busy: boolean };
    expect(typeof props.onClick).toBe('function'); // the modal has something to pick a file over
    expect(props.dragOver).toBe(false);
    expect(props.busy).toBe(false);
  });

  it('DropImportOverlay renders the SAME shared drop zone, lit and with no click-to-pick, while a file drags over the window', () => {
    render(<DropImportOverlay />, { wrapper: Wrapper });
    dragEnterWithFile();

    expect(dropZoneSpy).toHaveBeenCalled();
    const calls = dropZoneSpy.mock.calls;
    const last = calls[calls.length - 1]?.[0] as { onClick?: () => void; dragOver: boolean };
    expect(last.dragOver).toBe(true); // the whole point: lit the moment it's visible at all
    expect(last.onClick).toBeUndefined(); // nothing to pick a file over mid-drag — omitted, not a no-op
  });
});
