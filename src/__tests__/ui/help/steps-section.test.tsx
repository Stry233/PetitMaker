/**
 * steps-section.test.tsx — the Help Center's per-provider key walkthrough on Connecting the agent.
 *
 * The provider names and their console links come from the provider registry, never from copy, so
 * a renamed provider or a moved console page reaches the help with no string edit. Each provider
 * gets a bulleted list of steps; a provider with separate China and international consoles offers
 * both links.
 */
import { StrictMode } from 'react';
import { MotionConfig } from 'framer-motion';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/context';
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
  it('lists every provider from the registry with bulleted steps and its console link', async () => {
    const { container } = render(<Help />);
    await waitFor(() => expect(container.querySelector('#help-agsetup-keys')).toBeTruthy());
    const section = container.querySelector('#help-agsetup-keys')!.closest('section')!;
    for (const id of agentIds) {
      const group = section.querySelector(`[data-provider="${id}"]`);
      expect(group, `${id} has a group`).toBeTruthy();
      expect(group!.querySelector('h4')?.textContent).toContain(PROVIDER_META[id].name);
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
