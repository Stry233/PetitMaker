/**
 * scroll-gutter.test.tsx — the panel's insets read symmetric on every screen.
 *
 * A scroller that declares `scrollbar-gutter: stable` reserves a scrollbar's width of RIGHT inset
 * under classic scrollbars whether or not anything scrolls, and the panel nests scrollers (the job
 * zone around each screen's own), so the reservations stack into a one-sided margin: measured docked
 * at 1440x900, the disconnected screen stood 15px off the plate's left edge and 38px off its right.
 * So no scroller in the panel reserves a standing gutter: the room for a scrollbar is the
 * scrollbar's own, taken only while one shows, which is also the one state where an unequal inset
 * reads as a scrollbar rather than as padding.
 *
 * The sweep walks every rendered element, so a screen this file does not name is still covered by
 * whichever render mounts it. A gutter CONDITIONED on real overflow would pass here (nothing
 * overflows in a layout-free DOM), which is the correct boundary: the rule is against reserving
 * where nothing scrolls, not against giving a real scrollbar room.
 */
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

/** Every element whose inline style reserves a standing scrollbar gutter, named for the failure. */
function standingGutters(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => el.style.scrollbarGutter === 'stable')
    .map((el) => el.dataset.testid ?? el.tagName.toLowerCase());
}

describe('panel scrollers reserve no standing gutter', () => {
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
      expect(standingGutters(container)).toEqual([]);
      unmount();
    });
  }
});
