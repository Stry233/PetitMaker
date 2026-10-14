// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printConsoleBanner } from '../../../ui/app/console-banner';
import { LEGAL } from '../../../legal/config';
import { APP_NAME } from '../../../i18n/brand';
import lightLogo from '../../../../docs/media/banner-light.svg?raw';
import darkLogo from '../../../../docs/media/banner-dark.svg?raw';

afterEach(() => vi.restoreAllMocks());

describe('printConsoleBanner', () => {
  it('prints the README logo as a self-contained image and retains the canonical repo URL', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printConsoleBanner();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toBe('%c ');
    const style = String(log.mock.calls[0]![1]);
    const svg = atob(style.match(/data:image\/svg\+xml;base64,([^\"]+)/)![1]!);
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    const theme = document.querySelector('style')!.textContent!;
    expect(theme).toContain('@media(prefers-color-scheme:dark)');
    const light = new DOMParser().parseFromString(lightLogo, 'image/svg+xml');
    const dark = new DOMParser().parseFromString(darkLogo, 'image/svg+xml');
    expect(document.documentElement.getAttribute('viewBox')).toBe(light.documentElement.getAttribute('viewBox'));
    expect(document.querySelector('feFlood')!.getAttribute('flood-color')).toBe(light.querySelector('g')!.getAttribute('fill'));
    expect(theme).toContain(`flood-color:${dark.querySelector('g')!.getAttribute('fill')}`);
    expect(document.querySelector('image')!.getAttribute('xlink:href')).toMatch(/^data:image\/png;base64,/);
    expect(style.length).toBeLessThan(10000);
    expect(style).toContain('contain no-repeat');
    const invite = String(log.mock.calls[1]![0]);
    expect(invite).toContain(APP_NAME);
    expect(invite).toContain(LEGAL.repoUrl);
  });

  it('prints nothing at import time', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../../../ui/app/console-banner');
    expect(log).not.toHaveBeenCalled();
  });
});
