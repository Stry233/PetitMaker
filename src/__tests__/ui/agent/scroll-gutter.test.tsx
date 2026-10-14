// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { PanelView } from '../../../agent/core/project-view';
import { makeView, panelProps, Wrapper } from '../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: [], hydrated: true,
  });
});

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
        <PanelShell {...panelProps({
          view: screen.view,
          connected: screen.connected,
          pinned: screen.pinned,
          now: 0,
          ...VERBS,
        })}
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
