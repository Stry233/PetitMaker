/** Provider walkthroughs pair localized names with the correct console links. */
import { StrictMode } from 'react';
import { MotionConfig } from 'framer-motion';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerName } from '../../../i18n/providers';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/chrome/modals/help/HelpModal';
import { PROVIDER_IDS, PROVIDER_META } from '../../../agent/providers/defaults';
import { makeState } from '../../rules/_helpers';
import { setStoreState } from '../../_store';

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en', helpTarget: { page: 'agent-setup' } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Help() {
  return <StrictMode><MotionConfig reducedMotion="always"><I18nProvider><HelpModal open onClose={() => {}} /></I18nProvider></MotionConfig></StrictMode>;
}

const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');

describe('the key walkthrough on Connecting the agent', () => {
  it.each(['en', 'zh'] as const)('lists localized providers with steps and console links (%s)', async (locale) => {
    setStoreState({ locale });
    const { container } = render(<Help />);
    await waitFor(() => expect(container.querySelector('#help-agsetup-keys')).toBeTruthy());
    const section = container.querySelector('#help-agsetup-keys')!.closest('section')!;
    for (const id of agentIds) {
      const group = section.querySelector(`[data-provider="${id}"]`);
      expect(group, `${id} has a group`).toBeTruthy();
      expect(group!.querySelector('h4')?.textContent).toContain(providerName(id, key => translateFor(locale, key)));
      expect(group!.querySelectorAll('li').length, `${id} has steps`).toBeGreaterThanOrEqual(3);
      const links = [...group!.querySelectorAll('a')];
      expect(links.map((a) => a.getAttribute('href'))).toContain(PROVIDER_META[id].keyUrl);
      for (const a of links) {
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      }
      const intl = PROVIDER_META[id].keyUrlIntl;
      if (intl) expect(links.map((a) => a.getAttribute('href'))).toContain(intl);
      else expect(links.length).toBe(1);
    }
  });

  it('answers who bills for the agent', async () => {
    const { container } = render(<Help />);
    await waitFor(() => expect(container.textContent).toContain('Does the agent cost money'));
  });
});
