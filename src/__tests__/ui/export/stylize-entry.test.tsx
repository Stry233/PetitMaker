// The 画风 entry group in export controls: its default/applied sub-line and the door it opens.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StylizeEntry } from '../../../ui/chrome/modals/export/stylize/StylizeEntry';
import { versionStore } from '../../../io/stylize/versions';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';

const image = {} as HTMLImageElement;

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe('StylizeEntry', () => {
  beforeEach(() => {
    versionStore.reset();
    useEditorStore.setState({ locale: 'en' });
    useEditorStore.getState().setModal('stylize', false);
  });

  it('shows the default sub-line with nothing selected', () => {
    render(<StylizeEntry />, { wrapper: Wrapper });
    expect(screen.getByText('Illustrate this map')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
  });

  it('shows the applied version\'s name once one is minted and selected', () => {
    act(() => { versionStore.mint({ kind: 'model', direction: 'coastal', image, fingerprint: 0 }); });
    render(<StylizeEntry />, { wrapper: Wrapper });
    expect(screen.getByText('Applied: Coastal wash, take 1')).toBeTruthy();
  });

  it('opens the stylize window on click', () => {
    render(<StylizeEntry />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Illustrate this map'));
    expect(useEditorStore.getState().modals.stylize).toBe(true);
  });
});
