// @vitest-environment jsdom
/** Save and share's picture turns to a change by fading the new picture in over the one before, never
 *  leaving the stage empty between them, ending on the newest after quick changes, and changing at
 *  once under reduced motion. Each composed picture has its own width, which names it here. */
import { describe, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactElement } from 'react';

const painted = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../../../editor/export/preview', () => {
  const canvas = (width: number) => Object.assign(document.createElement('canvas'), { width, height: 30 });
  return {
    captureBaseMap: vi.fn(async () => ({ canvas: canvas(40) })),
    captureCard3dAngles: vi.fn(async () => []),
    loadBrandLockup: async () => null,
    paintPreview: vi.fn(() => canvas(101 + painted.count++)),
  };
});

import { I18nProvider } from '../../../../../i18n/context';
import { ExportPreview } from '../../../../../ui/chrome/modals/export/ExportPreview';
import { useEditorStore } from '../../../../../state/store';
import { createGridState } from '../../../../../core/model/template';
import { getMapTemplate } from '../../../../../config/maps';
import { DEFAULT_FOOTER } from '../../../../../io/export/footer-template';
import type { ExportOptions } from '../../../../../io/export/types';
import { spec } from '../../../../_support/spec';

const base: ExportOptions = {
  title: '', description: '', preset: 'share', showBadge: false, layerPreview: false,
  card3d: false, grid: true, annotations: true, footer: false, footerTemplate: DEFAULT_FOOTER, resolution: 'standard',
};

const pictures = () => [...document.querySelectorAll('canvas')];
const newest = () => document.querySelector<HTMLCanvasElement>('canvas[data-export-preview]');
const opacity = (el: HTMLElement) => (el.style.opacity === '' ? 1 : Number(el.style.opacity));
const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** One state the stage passed through: its pictures bottom to top, by width, with their opacities. */
interface Shown { widths: number[]; opacities: number[]; newest: number | undefined }

/** Records the stage after every change to its pictures or their opacity, so no state between two
 *  samples escapes. */
function record(): { states: Shown[]; stop: () => void } {
  const states: Shown[] = [];
  const observer = new MutationObserver(() => {
    states.push({ widths: pictures().map((p) => p.width), opacities: pictures().map(opacity), newest: newest()?.width });
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'width', 'data-export-preview'] });
  return { states, stop: () => observer.disconnect() };
}

function preview(title: string, reduced: boolean): ReactElement {
  const view = <I18nProvider><ExportPreview open options={base} words={{ title }} summary={null} /></I18nProvider>;
  return reduced ? <MotionConfig reducedMotion="always">{view}</MotionConfig> : view;
}

/** The preview open on its first picture. */
async function opened(reduced = false) {
  const view = render(preview('', reduced));
  await waitFor(() => expect(newest()).not.toBeNull());
  return { first: newest()!.width, retitle: (title: string) => view.rerender(preview(title, reduced)) };
}

/** The stage holds only the picture painted `paints` pictures after the ones painted so far, whole. */
async function settled(paints: number, from: number): Promise<number> {
  await waitFor(() => expect(painted.count).toBe(from + paints));
  const last = 100 + painted.count;
  await waitFor(() => expect(pictures().map((p) => [p.width, opacity(p)])).toEqual([[last, 1]]), { timeout: 2000 });
  return last;
}

beforeEach(() => {
  painted.count = 0;
  act(() => { useEditorStore.setState({ gridState: createGridState(getMapTemplate('hexia')), locale: 'en' }); });
});
afterEach(() => { cleanup(); });

describe('the share picture turning to a change', () => {
  spec('UI-71', 'fades the new picture in over the old one, which stays whole until the new one has appeared', async () => {
    const { first, retitle } = await opened();
    const { states, stop } = record();
    const from = painted.count;
    retitle('Harbour');
    const next = await settled(1, from);
    stop();
    const arrival = states.find((s) => s.widths.includes(next))!;
    expect(arrival.widths, 'the new picture arrives on top of the old one').toEqual([first, next]);
    expect(arrival.opacities, 'the old picture whole beneath, the new one not yet shown').toEqual([1, 0]);
    expect(states.some((s) => s.newest === next && s.opacities.at(-1)! > 0 && s.opacities.at(-1)! < 1), 'the new picture fades in').toBe(true);
    for (const s of states) expect(s.opacities.some((o) => o === 1), `a whole picture in ${JSON.stringify(s)}`).toBe(true);
  });

  spec('UI-71', 'ends quick changes on the newest picture with a whole picture on the stage throughout', async () => {
    const { retitle } = await opened();
    const { states, stop } = record();
    const from = painted.count;
    // Each change outlasts the paint's settling but not the fade, so the fades overlap.
    for (const title of ['H', 'Ha', 'Har']) { retitle(title); await pause(80); }
    const last = await settled(3, from);
    stop();
    expect(states.some((s) => s.widths.length > 2), 'the fades overlapped').toBe(true);
    for (const s of states) {
      expect(s.opacities.some((o) => o === 1), `a whole picture in ${JSON.stringify(s)}`).toBe(true);
      expect(s.widths.at(-1), `the newest picture on top in ${JSON.stringify(s)}`).toBe(s.newest);
    }
    expect(states.at(-1)!.widths).toEqual([last]);
  });

  spec('UI-71', 'changes the picture at once under reduced motion', async () => {
    const { first, retitle } = await opened(true);
    const { states, stop } = record();
    const from = painted.count;
    retitle('Harbour');
    const next = await settled(1, from);
    stop();
    const after = states.filter((s) => s.widths.includes(next));
    expect(after.length).toBeGreaterThan(0);
    for (const s of after) {
      expect(s.widths.at(-1), 'the new picture on top').toBe(next);
      expect(s.opacities.at(-1), 'the new picture whole from its first frame').toBe(1);
    }
    expect(first).not.toBe(next);
  });
});
