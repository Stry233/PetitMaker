/**
 * The drop zone is shared by the Import modal and the window drag overlay, and only one of them
 * can be clicked. Its copy has to follow that, or the overlay invites a click it cannot honour.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../i18n/context';
import { ImportDropZone } from '../../ui/chrome/import/ImportDropZone';
import { en } from '../../i18n/locales/en';
import { setStoreState } from '../_store';

// noUncheckedIndexedAccess types a locale lookup as possibly-undefined; these keys exist, and
// the i18n coverage test is what guards that, so they are named once here.
const DROP = en['import.drop']!;
const DROP_ONLY = en['import.drop_only']!;
const BUSY = en['import.busy']!;

setStoreState({ locale: 'en' });
afterEach(cleanup);

describe('the drop zone copy matches its affordance', () => {
  it('offers the click in the modal, where a click opens the file picker', () => {
    render(<I18nProvider><ImportDropZone dragOver={false} busy={false} onClick={() => {}} /></I18nProvider>);
    expect(screen.getByText(DROP)).toBeTruthy();
  });

  it('drops the offer in the drag overlay, which has nothing to pick', () => {
    render(<I18nProvider><ImportDropZone dragOver busy={false} /></I18nProvider>);
    expect(screen.getByText(DROP_ONLY)).toBeTruthy();
    expect(screen.queryByText(DROP)).toBeNull();
  });

  it('shows the busy copy in both, since an import in flight is not a click target either', () => {
    render(<I18nProvider><ImportDropZone dragOver={false} busy onClick={() => {}} /></I18nProvider>);
    expect(screen.getByText(BUSY)).toBeTruthy();
  });
});
