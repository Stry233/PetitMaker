import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrandLockup } from '../../../ui/chrome/BrandLockup';
import { I18nProvider } from '../../../i18n/context';
import { setStoreState } from '../../_store';
import { APP_NAME } from '../../../version';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

describe('BrandLockup', () => {
  beforeEach(() => { setStoreState({ locale: 'en' }); });
  afterEach(cleanup);

  it('shows the app name beside the logo', () => {
    render(<BrandLockup size={72} />, { wrapper });
    expect(screen.getByText(APP_NAME)).toBeTruthy();
  });

  it('points at the same logo file the favicon uses', () => {
    const { container } = render(<BrandLockup size={72} />, { wrapper });
    // The logo is decorative (alt=""), so it is absent from the accessibility tree
    // and has to be found in the DOM rather than by role.
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('logo-256.png');
  });

  it('shows the tagline only when asked', () => {
    const { rerender } = render(<BrandLockup size={72} />, { wrapper });
    expect(screen.queryByText('Map Editor')).toBeNull();
    rerender(<I18nProvider><BrandLockup size={72} tagline /></I18nProvider>);
    expect(screen.getByText('Map Editor')).toBeTruthy();
  });

  it('drops the name for the tour, keeping it as what a screen reader announces', () => {
    // The welcome step already has a title and a body; a third piece of text in that small card is
    // the name, and the logo carries it.
    const { container } = render(<BrandLockup size={54} logoOnly />, { wrapper });
    expect(screen.queryByText(APP_NAME)).toBeNull();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe(APP_NAME);
    expect(img.getAttribute('role')).toBeNull();
  });

  it('scales the gap with the logo, matching the masthead proportions', () => {
    const { container } = render(<BrandLockup size={100} />, { wrapper });
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.gap).toBe('19px'); // 32/172 of the logo size, per the README masthead
  });
});
