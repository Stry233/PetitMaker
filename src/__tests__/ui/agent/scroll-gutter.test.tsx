import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { PanelView } from '../../../agent/core/project-view';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: [], hydrated: true,
  });
});

function makeView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle',
    jobs: [],
    queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null,
    lastEventAt: 0,
    ...over,
  };
}

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

describe('panel scroll ownership', () => {
  const steers = [
    { seq: 1, text: 'more trees' },
    { seq: 2, text: 'wider road' },
  ];

  const screens: { name: string; connected: boolean; pinned: boolean; view: PanelView }[] = [
    { name: 'disconnected, docked', connected: false, pinned: true, view: makeView() },
    { name: 'disconnected, floating', connected: false, pinned: false, view: makeView() },
    { name: 'idle desk, docked', connected: true, pinned: true, view: makeView() },
    {
      name: 'running with queued steers, docked',
      connected: true,
      pinned: true,
      view: makeView({
        phase: 'streaming',
        current: {
          orderSeq: 1, orderText: 'build a village', orderAt: 0,
          asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
        },
        queuedSteers: steers,
      }),
    },
  ];

  for (const screen of screens) {
    it(`on the ${screen.name} screen`, () => {
      const { container, unmount } = render(
        <PanelShell
          view={screen.view}
          connected={screen.connected}
          pinned={screen.pinned}
          now={0}
          {...VERBS}
        />,
        { wrapper: Wrapper },
      );
      const zone = container.querySelector('[data-testid="panel-job-zone"]')!;
      expect(zone.querySelectorAll('[data-scroll-content]')).toHaveLength(1);
      expect(zone.querySelector('[data-scroll-content]')?.parentElement).toBe(zone);
      expect((zone as HTMLElement).style.maskImage).toBe('');
      unmount();
    });
  }
});
