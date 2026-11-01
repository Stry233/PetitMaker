// @vitest-environment jsdom
/**
 * Windows on an upright screen keep their frame, scrolling one region between a head and a foot that
 * stay in the card; Settings keeps its cursor and keyboard sections for PC mode. A scroller is read
 * from the inline overflow style, which is how every window declares one. jsdom has no layout, so a
 * window body (the element carrying `data-columns`) reports its card's inline width, only to bring a
 * body to its one-column form; how many columns fit and how wide a card stands are checked in a browser.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { SettingsModal } from '../../../ui/chrome/modals/settings/SettingsModal';
import { ShareWindow } from '../../../ui/chrome/modals/export/ShareWindow';
import { AboutModal } from '../../../ui/chrome/modals/about/AboutModal';
import { ChangePlanetModal } from '../../../ui/chrome/modals/planet/ChangePlanetModal';
import { PlanetImportWindow } from '../../../ui/chrome/modals/planet/PlanetImportWindow';
import { ImportModal } from '../../../ui/chrome/modals/import/ImportModal';
import { KeyboardModal } from '../../../ui/chrome/modals/keyboard/KeyboardModal';
import { ChunkLoadWindow } from '../../../ui/chrome/modals/load/ChunkLoadWindow';
import { ConfirmationModal } from '../../../ui/primitives/ConfirmationModal';
import { StylizeWindow } from '../../../ui/chrome/modals/export/stylize/StylizeWindow';
import { WhatsNewModal } from '../../../ui/chrome/modals/whats-new/WhatsNewModal';
import { useExportNotice } from '../../../ui/chrome/modals/export/review/ExportNotice';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { TOUCH_UI_ZOOM_DEFAULT, UI_ZOOM_DEFAULT } from '../../../platform/storage/prefs';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;

/** A window body's width, which picks its column form: the inline width of the card it stands in.
 *  Other elements keep jsdom's 0. */
function bodyWidth(el: Element): number {
  if (!el.hasAttribute('data-columns')) return clientWidth.get!.call(el) as number;
  const card = el.closest<HTMLElement>('[role="dialog"]');
  const match = card?.style.width.match(/[\d.]+/);
  return match ? Number(match[0]) : 0;
}

beforeEach(() => {
  setStoreState({ locale: 'en' });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get(this: Element) { return bodyWidth(this); } });
});
/** Settles the UI scale at `inputMode`'s default. */
function atDefaultScale(inputMode: InputMode): void {
  act(() => { useEditorStore.setState({ uiZoom: inputMode === 'touch' ? TOUCH_UI_ZOOM_DEFAULT : UI_ZOOM_DEFAULT }); __resetUiZoomAnim(); });
}

afterEach(() => {
  cleanup();
  act(() => { for (const id of ['share', 'regionLoad', 'planetImport', 'whatsNew'] as const) useEditorStore.getState().setModal(id, false); });
  Object.defineProperty(Element.prototype, 'clientWidth', clientWidth);
  sizeWindow(1024, 768);
});

function mount(node: ReactNode, inputMode: InputMode, shape: LayoutShape) {
  return render(<I18nProvider><InputModeProvider inputMode={inputMode} shape={shape}>{node}</InputModeProvider></I18nProvider>);
}

describe('windows on an upright screen', () => {
  spec('UI-31', 'Settings at 390x844 keeps its header and close', () => {
    sizeWindow(390, 844);
    mount(<SettingsModal open onClose={() => {}} />, 'touch', 'portrait');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByText('Settings')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  spec('UI-27', 'a window on an upright screen in PC mode keeps the live chrome zoom; touch mode at its default lifts it to a fingertip', () => {
    sizeWindow(390, 844);
    const zoomIn = (inputMode: InputMode, shape: LayoutShape) => {
      const view = mount(<SettingsModal open onClose={() => {}} />, inputMode, shape);
      const zoom = Number(screen.getByRole('dialog', { name: 'Settings' }).style.zoom);
      view.unmount();
      return zoom;
    };
    const live = zoomIn('pc', 'landscape');
    expect(zoomIn('pc', 'portrait')).toBeCloseTo(live);
    expect(live).toBeLessThan(1);
    atDefaultScale('touch');
    expect(zoomIn('touch', 'portrait')).toBeGreaterThanOrEqual(44 / 34);
    atDefaultScale('pc');
  });

  spec('UI-34', 'at 100% on a phone in touch mode every button in a window answers a press a fingertip across', () => {
    sizeWindow(390, 844);
    mount(<SettingsModal open onClose={() => {}} />, 'touch', 'portrait');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect(button.querySelector('[data-touch-reach]'), button.getAttribute('aria-label') ?? button.textContent ?? '').not.toBeNull();
    }
  });

  spec('UI-30', 'Settings hides the cursor and keyboard sections in touch mode and shows them in PC mode', () => {
    sizeWindow(390, 844);
    const view = mount(<SettingsModal open onClose={() => {}} />, 'touch', 'portrait');
    expect(screen.queryByRole('radiogroup', { name: 'Cursor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keyboard Shortcuts' })).toBeNull();
    view.rerender(<I18nProvider><InputModeProvider inputMode="pc" shape="portrait"><SettingsModal open onClose={() => {}} /></InputModeProvider></I18nProvider>);
    expect(screen.getByRole('radiogroup', { name: 'Cursor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keyboard Shortcuts' })).toBeTruthy();
  });

  spec('UI-31', 'For friends shows the preview above the form', async () => {
    sizeWindow(390, 844);
    mount(<ShareWindow />, 'touch', 'portrait');
    act(() => { useEditorStore.getState().openShare('friend'); });
    const dialog = await screen.findByRole('dialog', { name: 'Save and share' });
    const panel = within(dialog).getByTestId('export-panel');
    const preview = within(panel).getByTestId('export-preview');
    const title = within(panel).getByRole('textbox', { name: /title/i });
    expect(preview.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  spec('UI-31', 'For friends scrolls its preview and settings as one region and keeps its buttons out of it', async () => {
    sizeWindow(375, 667);
    mount(<ShareWindow />, 'touch', 'portrait');
    act(() => { useEditorStore.getState().openShare('friend'); });
    const dialog = await screen.findByRole('dialog', { name: 'Save and share' });
    const panel = within(dialog).getByTestId('export-panel');
    const scrollersAbove = (el: Element) => {
      const found: HTMLElement[] = [];
      for (let node = el.parentElement; node && node !== dialog.parentElement; node = node.parentElement) {
        if (['auto', 'scroll'].includes(node.style.overflowY)) found.push(node);
      }
      return found;
    };
    const preview = within(panel).getByTestId('export-preview');
    const title = within(panel).getByRole('textbox', { name: /title/i });
    expect(scrollersAbove(preview)).toHaveLength(1);
    expect(scrollersAbove(title)).toEqual(scrollersAbove(preview));
    expect(scrollersAbove(within(panel).getByRole('button', { name: 'Export image' }))).toEqual([]);
  });

  spec('UI-31', 'Keep working scrolls its save options as one region and keeps the pretty-print and total row with its buttons out of it', async () => {
    sizeWindow(375, 667);
    mount(<ShareWindow />, 'touch', 'portrait');
    act(() => { useEditorStore.getState().openShare('keep'); });
    const dialog = await screen.findByRole('dialog', { name: 'Save and share' });
    const scrollersAbove = (el: Element) => {
      const found: HTMLElement[] = [];
      for (let node = el.parentElement; node && node !== dialog.parentElement; node = node.parentElement) {
        if (['auto', 'scroll'].includes(node.style.overflowY)) found.push(node);
      }
      return found;
    };
    const lastOption = within(dialog).getByText('Self-describing reference for the catalog objects placed here');
    const pretty = within(dialog).getByRole('switch', { name: 'Pretty-print' });
    expect(scrollersAbove(lastOption)).toHaveLength(1);
    expect(scrollersAbove(pretty)).toEqual([]);
    expect(scrollersAbove(within(dialog).getByRole('button', { name: 'Export' }))).toEqual([]);
    expect(scrollersAbove(within(dialog).getByRole('button', { name: 'Cancel' }))).toEqual([]);
  });
});

/** The elements between `el` and its dialog card, the card included, that scroll up and down. */
function scrollersAbove(el: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    const y = node.style.overflowY || node.style.overflow;
    if (y === 'auto' || y === 'scroll') found.push(node);
    if (node.getAttribute('role') === 'dialog') break;
  }
  return found;
}

/** Every element inside `dialog`, the card included, that scrolls up and down. */
function scrollersIn(dialog: HTMLElement): HTMLElement[] {
  return [dialog, ...dialog.querySelectorAll<HTMLElement>('*')].filter((node) => {
    const y = node.style.overflowY || node.style.overflow;
    return y === 'auto' || y === 'scroll';
  });
}

interface FramedWindow {
  name: string;
  /** Mounts the window open and returns its card. */
  open: () => HTMLElement | Promise<HTMLElement>;
  /** The controls of its head and foot, which never scroll with its content. */
  fixed: (dialog: HTMLElement) => HTMLElement[];
  /** Why its one scroller is its own rather than the shared window body, for a window whose region is not a plain vertical list. */
  ownScroller?: string;
}

const close = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Close' });
const button = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name });

/** The notice an export asks for before its download. */
function AskingNotice() {
  const { request, notice } = useExportNotice(true, 0, null);
  useEffect(() => { void request(); }, [request]);
  return notice;
}

/** The stylize window on its studio page, its asynchronous boot settled. */
async function stylize(): Promise<HTMLElement> {
  mount(<StylizeWindow onClose={() => {}} listModels={async () => ['a-model']} />, 'touch', 'portrait');
  await act(async () => { await Promise.resolve(); });
  return screen.getByRole('dialog', { name: 'Map illustration' });
}

/** Save and share opened at `section`. */
async function share(section: 'keep' | 'friend' | 'game'): Promise<HTMLElement> {
  mount(<ShareWindow />, 'touch', 'portrait');
  act(() => { useEditorStore.getState().openShare(section); });
  return screen.findByRole('dialog', { name: 'Save and share' });
}

const FRAMED: FramedWindow[] = [
  {
    name: 'Settings',
    open: () => { mount(<SettingsModal open onClose={() => {}} />, 'touch', 'portrait'); return screen.getByRole('dialog', { name: 'Settings' }); },
    fixed: (dialog) => [close(dialog)],
  },
  {
    name: 'Change planet',
    open: () => {
      act(() => { newMap(editorPort, 'hexia'); });
      mount(<ChangePlanetModal open onClose={() => {}} onSwitch={() => {}} />, 'touch', 'portrait');
      return screen.getByRole('dialog', { name: 'Change a planet' });
    },
    fixed: (dialog) => [close(dialog), within(dialog).getByRole('button', { name: 'Cancel' }), within(dialog).getByTestId('planet-switch')],
  },
  {
    name: 'Import planet',
    open: () => {
      act(() => { useEditorStore.getState().setModal('planetImport', true); });
      mount(<PlanetImportWindow open onClose={() => {}} onScanned={() => true} onPickFile={() => {}} canEdit />, 'touch', 'portrait');
      return screen.getByRole('dialog', { name: 'Import planet' });
    },
    fixed: (dialog) => [close(dialog), within(dialog).getByTestId('planet-import-cancel')],
  },
  {
    name: 'Import',
    open: () => { mount(<ImportModal open onClose={() => {}} />, 'touch', 'portrait'); return screen.getByRole('dialog', { name: 'Import map' }); },
    fixed: (dialog) => [close(dialog)],
  },
  {
    name: 'a confirmation',
    open: () => {
      mount(<ConfirmationModal open title="Erase everything?" message={'Every map and setting on this device goes. '.repeat(40)}
        cancelLabel="Keep" confirmLabel="Erase" onCancel={() => {}} onConfirm={() => {}} />, 'touch', 'portrait');
      return screen.getByRole('dialog', { name: 'Erase everything?' });
    },
    fixed: (dialog) => [within(dialog).getByRole('heading', { name: 'Erase everything?' }),
      within(dialog).getByRole('button', { name: 'Keep' }), within(dialog).getByRole('button', { name: 'Erase' })],
  },
  {
    name: 'Keyboard Shortcuts',
    open: () => { mount(<KeyboardModal open onClose={() => {}} />, 'pc', 'portrait'); return screen.getByRole('dialog', { name: 'Keyboard Shortcuts' }); },
    fixed: (dialog) => [close(dialog)],
    ownScroller: 'the board scrolls on both axes at a height fitted to its zoom, with its own drawn sideways bar',
  },
  {
    name: 'Export notice',
    open: () => { mount(<AskingNotice />, 'touch', 'portrait'); return screen.findByRole('dialog', { name: 'Before you export' }); },
    // Its foot is Cancel and the confirmation, the last two buttons in the card.
    fixed: (dialog) => [close(dialog), ...within(dialog).getAllByRole('button').slice(-2)],
  },
  {
    name: "What's new",
    open: () => {
      act(() => { useEditorStore.getState().setModal('whatsNew', true); });
      mount(<WhatsNewModal />, 'touch', 'portrait');
      return screen.getByRole('dialog');
    },
    // Its foot is the full changelog and Got it, the last two buttons in the card.
    fixed: (dialog) => [close(dialog), ...within(dialog).getAllByRole('button').slice(-2)],
  },
  {
    name: 'Stylize, studio',
    open: stylize,
    fixed: (dialog) => [close(dialog), button(dialog, 'Done'), button(dialog, 'Generate illustration')],
  },
  {
    name: 'Stylize, connection',
    open: async () => {
      const dialog = await stylize();
      act(() => { within(dialog).getByRole('button', { name: /Forest watercolor/ }).click(); });
      act(() => { button(dialog, 'Add a key').click(); });
      // The studio page leaves as the connection page arrives.
      await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Generate illustration' })).toBeNull());
      return dialog;
    },
    fixed: (dialog) => [close(dialog), button(dialog, 'Cancel'), button(dialog, 'Start creating')],
  },
  {
    name: 'Save and share, Keep working',
    open: () => share('keep'),
    fixed: (dialog) => [close(dialog), within(dialog).getByRole('switch', { name: 'Pretty-print' }), button(dialog, 'Cancel'), button(dialog, 'Export')],
  },
  {
    name: 'Save and share, For a friend',
    open: () => share('friend'),
    fixed: (dialog) => [close(dialog), button(dialog, 'Cancel'), button(dialog, 'Export image')],
  },
  {
    name: 'Save and share, Into the game',
    open: () => share('game'),
    fixed: (dialog) => [close(dialog)],
  },
  {
    name: 'About',
    open: () => { mount(<AboutModal open onClose={() => {}} />, 'touch', 'portrait'); return screen.getByRole('dialog', { name: 'About' }); },
    fixed: (dialog) => [within(dialog).getByTestId('about-close')],
  },
  {
    name: 'Regional load',
    open: () => {
      act(() => { newMap(editorPort, 'hexia'); useEditorStore.getState().setModal('regionLoad', true); });
      mount(<ChunkLoadWindow />, 'touch', 'portrait');
      return screen.getByRole('dialog');
    },
    fixed: (dialog) => [close(dialog), within(dialog).getByRole('switch')],
  },
];

describe('every window on an upright screen keeps its head and foot in the card', () => {
  for (const framed of FRAMED) {
    spec('UI-31', `${framed.name} scrolls one region and keeps its head and foot out of it`, async () => {
      sizeWindow(375, 667);
      const dialog = await framed.open();
      const scrollers = scrollersIn(dialog);
      expect(scrollers).toHaveLength(1);
      expect(scrollers[0]).not.toBe(dialog);
      // Every window scrolls through the shared body, so each scrolls, fades and clears its focus rings alike.
      if (!framed.ownScroller) expect(scrollers[0]!.hasAttribute('data-window-body')).toBe(true);
      for (const control of framed.fixed(dialog)) expect(scrollersAbove(control)).toEqual([]);
    });
  }
});

describe('a window whose body scrolls', () => {
  const props = ['offsetHeight', 'clientHeight', 'scrollHeight'] as const;
  const saved = props.map((k) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, k) ?? Object.getOwnPropertyDescriptor(Element.prototype, k));
  /** Gives the window body `shown` px of `content` and every footer 52 px, as layout would; a joined
   *  footer adds its height to the body's. */
  function heights(shown: number, content: number): void {
    const joined = (el: Element) => !!el.closest('[role="dialog"]')?.querySelector('[data-window-footer="joined"]');
    const define = (k: typeof props[number], get: (el: HTMLElement) => number) =>
      Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get(this: HTMLElement) { return get(this); } });
    define('offsetHeight', (el) => (el.hasAttribute('data-window-footer') ? 52 : 0));
    define('clientHeight', (el) => (el.hasAttribute('data-window-body') ? shown + (joined(el) ? 52 : 0) : 0));
    define('scrollHeight', (el) => (el.hasAttribute('data-window-body') ? content + (joined(el) ? 52 : 0) : 0));
  }
  afterEach(() => {
    props.forEach((k, i) => {
      if (saved[i]) Object.defineProperty(HTMLElement.prototype, k, saved[i]!);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
    });
  });

  function whatsNew() {
    act(() => { useEditorStore.getState().setModal('whatsNew', true); });
    mount(<WhatsNewModal />, 'touch', 'landscape');
    return screen.getByRole('dialog');
  }
  spec('UI-31', 'scrolling the body tucks the title to a smaller size, and scrolling back restores it', async () => {
    sizeWindow(1280, 800);
    heights(300, 900);
    const dialog = whatsNew();
    const scroller = dialog.querySelector<HTMLElement>('[data-window-body]')!;
    const title = () => parseFloat(dialog.querySelector<HTMLElement>('[data-window-title]')!.style.fontSize);
    const full = title();
    act(() => { scroller.scrollTop = 200; scroller.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(title()).toBeLessThan(full * 0.8));
    act(() => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll')); });
    await waitFor(() => expect(title()).toBeCloseTo(full, 6));
  });
});
