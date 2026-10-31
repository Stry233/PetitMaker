// @vitest-environment jsdom
// Import map and the page drop overlay show one drop zone: the same box and import note, which offers
// a click to pick a file only where there is something to click.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../../i18n/context';
import { makeState } from '../../../../_support/map-state';
import { ImportModal } from '../../../../../ui/chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../../../../ui/chrome/modals/import/DropImportOverlay';
import { setStoreState, setStoreModal } from '../../../../_support/store';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="always"><I18nProvider>{children}</I18nProvider></MotionConfig>;
}

function dragEnterWithFile(): void {
  const e = new Event('dragenter', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
  e.dataTransfer = { types: ['Files'], files: [] };
  act(() => { window.dispatchEvent(e); });
}

/** The drop zone's box and the note the window shows under it. */
function dropZone(): { box: HTMLElement; note: string } {
  const box = screen.getByTestId('import-drop-zone');
  return { box, note: box.nextElementSibling?.textContent ?? '' };
}

describe('Import map and the drop overlay share one drop zone', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en', gridState: makeState() });
    setStoreModal('import', false);
  });

  it('shows the same note in both, and only the Import window offers a click to pick a file', () => {
    setStoreModal('import');
    const { unmount } = render(<ImportModal />, { wrapper: Wrapper });
    const inWindow = dropZone();
    expect(inWindow.box.getAttribute('role')).toBe('button');
    expect(inWindow.note).not.toBe('');
    unmount();
    setStoreModal('import', false);
    cleanup();

    render(<DropImportOverlay />, { wrapper: Wrapper });
    dragEnterWithFile();
    const overlay = dropZone();
    expect(overlay.box.getAttribute('role')).toBeNull();
    expect(overlay.note).toBe(inWindow.note);
  });
});
