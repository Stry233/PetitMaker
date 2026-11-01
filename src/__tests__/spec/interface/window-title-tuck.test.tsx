// @vitest-environment jsdom
/**
 * Save and share's title under reduced motion: a scroll tucks it, and turning to another section sets
 * it to that section's size at once. Which bodies tuck the title and how it glides depend on the real
 * layout and are checked in a browser.
 *
 * jsdom has no layout, so this stands one in: a card is as wide as its inline width, a window body
 * spans the card's content unless it stands in a grid whose first track is a px column (the share
 * picture's settings), where it is that track's width, and a shown body is 300 px tall over 900 px of
 * content while a hidden one (under `display: none`) measures nothing. jsdom has no size observer
 * either, so a stand-in one reports every observed box once a section is shown or hidden, as the
 * browser does when a box appears or disappears.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig, MotionGlobalConfig, frameData } from 'framer-motion';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { ShareWindow } from '../../../ui/chrome/modals/export/ShareWindow';
import { windowTitle } from '../../../ui/design/window-skin';

const FULL = Number(windowTitle.fontSize);
/** The card padding at each side (`Window.tsx:WINDOW_PADDING_X`) and the body's clip bleed. */
const PAD_X = 24;
const BLEED = 6;

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

const hidden = (el: Element) => {
  for (let a: Element | null = el; a; a = a.parentElement) if ((a as HTMLElement).style?.display === 'none') return true;
  return false;
};
const cardOf = (el: Element) => el.closest<HTMLElement>('[role="dialog"]');
const px = (v: string | undefined) => Number(v?.match(/[\d.]+/)?.[0] ?? 0);
const cardWidth = (card: HTMLElement | null) => (card ? px(card.style.width) : 0);

function bodyWidth(body: Element): number {
  if (hidden(body)) return 0;
  for (let a = body.parentElement; a && a.getAttribute('role') !== 'dialog'; a = a.parentElement) {
    const track = /^(\d+)px\s/.exec(a.style.gridTemplateColumns);
    if (track) return Number(track[1]) + 2 * BLEED;
  }
  return cardWidth(cardOf(body)) - 2 * PAD_X + 2 * BLEED;
}

const saved = (['clientWidth', 'offsetWidth', 'clientHeight', 'scrollHeight'] as const).map((k) => [k,
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, k) ?? Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);

function standInLayout(): void {
  const define = (k: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get(this: HTMLElement) { return get(this); } });
  const isBody = (el: HTMLElement) => el.hasAttribute('data-window-body');
  define('clientWidth', (el) => {
    if (el.getAttribute('role') === 'dialog') return cardWidth(el);
    if (el.hasAttribute('data-columns')) return hidden(el) ? 0 : cardWidth(cardOf(el)) - 2 * PAD_X;
    return isBody(el) ? bodyWidth(el) : 0;
  });
  define('offsetWidth', (el) => (isBody(el) ? bodyWidth(el) : 0));
  define('clientHeight', (el) => (isBody(el) && !hidden(el) ? 300 : 0));
  define('scrollHeight', (el) => (isBody(el) && !hidden(el) ? 900 : 0));
}

/** Every live stand-in observer's callback; `resized` runs them all. */
const observers = new Set<() => void>();
class StandInResizeObserver {
  private readonly run: () => void;
  constructor(callback: ResizeObserverCallback) { this.run = () => callback([], this as unknown as ResizeObserver); }
  observe() { observers.add(this.run); }
  unobserve() {}
  disconnect() { observers.delete(this.run); }
}
const resized = () => act(() => { for (const run of [...observers]) run(); });

beforeEach(() => {
  MotionGlobalConfig.useManualTiming = true;
  setStoreState({ locale: 'en' });
  standInLayout();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StandInResizeObserver;
});
afterEach(() => {
  MotionGlobalConfig.useManualTiming = false;
  cleanup();
  act(() => { useEditorStore.getState().setModal('share', false); });
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
  sizeWindow(1024, 768);
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  observers.clear();
});

async function share(section: 'keep' | 'friend', inputMode: InputMode, shape: LayoutShape, reduced = false) {
  render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider><InputModeProvider inputMode={inputMode} shape={shape}><ShareWindow /></InputModeProvider></I18nProvider>
    </MotionConfig>,
  );
  act(() => { useEditorStore.getState().openShare(section); });
  return screen.findByRole('dialog', { name: 'Save and share' });
}

const title = (dialog: HTMLElement) => parseFloat(dialog.querySelector<HTMLElement>('[data-window-title]')!.style.fontSize || String(FULL));
const shownBody = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>('[data-window-body]')].find((b) => !hidden(b))!;
function scroll(body: HTMLElement, top: number): void {
  act(() => { body.scrollTop = top; body.dispatchEvent(new Event('scroll')); });
}
/** Runs `ms` of motion on the animation clock, a frame per 16 ms whatever the machine's load: the
 *  clock is Framer's manual timing, which each frame here moves on. */
async function play(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 16) {
    frameData.timestamp += 16;
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  }
}
function turnTo(dialog: HTMLElement, name: string): void {
  act(() => { fireEvent.click(within(dialog).getByRole('button', { name })); });
  resized();
}

describe('the title tuck under reduced motion', () => {
  spec('UI-31', 'with reduced motion the turn sets the title at once', async () => {
    sizeWindow(1440, 900);
    const dialog = await share('keep', 'pc', 'landscape', true);
    scroll(shownBody(dialog), 200);
    await play(48);
    expect(title(dialog)).toBeLessThan(FULL * 0.8);
    turnTo(dialog, 'For a friend');
    await play(48);
    expect(title(dialog)).toBeCloseTo(FULL, 6);
  });
});
