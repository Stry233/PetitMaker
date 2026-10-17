// @vitest-environment jsdom
/** The recording guide on Change a planet: the window's steps as a numbered list, and each fix a
 *  deep-link target the import window's refusals scroll to. */
import { StrictMode } from 'react';
import { MotionConfig } from 'framer-motion';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/help/HelpModal';
import { VIDEO_FIXES, VIDEO_GUIDE_HELP, VIDEO_STEPS, videoFixAnchor } from '../../../ui/chrome/modals/planet/video-guide';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';

const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function Help() {
  return <StrictMode><MotionConfig reducedMotion="always"><I18nProvider><HelpModal open onClose={() => {}} /></I18nProvider></MotionConfig></StrictMode>;
}

describe('the recording guide in Help', () => {
  it.each(['en', 'zh'] as const)('numbers the window\'s steps under the window\'s title (%s)', async (locale) => {
    setStoreState({ gridState: makeState(20, 20), locale, helpTarget: { page: VIDEO_GUIDE_HELP.page, anchor: VIDEO_GUIDE_HELP.anchor } });
    const { baseElement } = render(<Help />);
    await waitFor(() => expect(scrolled).toContain(`help-${VIDEO_GUIDE_HELP.anchor}`));
    const heading = baseElement.querySelector(`#help-${VIDEO_GUIDE_HELP.anchor}`)!;
    expect(heading.textContent).toBe(translateFor(locale, 'planet.scan_title'));
    const list = heading.closest('section')!.querySelector('ol')!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(VIDEO_STEPS.map((key) => translateFor(locale, key)));
  });

  it.each(VIDEO_FIXES.map((fix) => fix.failures[0]!))('scrolls to the fix for %s', async (reason) => {
    const anchor = videoFixAnchor(reason);
    setStoreState({ gridState: makeState(20, 20), locale: 'en', helpTarget: { page: 'planet', anchor } });
    const { baseElement } = render(<Help />);
    await waitFor(() => expect(scrolled).toContain(`help-${anchor}`));
    const item = baseElement.querySelector(`#help-${anchor}`)!;
    expect(item.tagName).toBe('LI');
    expect(item.textContent).toBe(translateFor('en', VIDEO_FIXES.find((fix) => fix.anchor === anchor)!.key));
  });
});
