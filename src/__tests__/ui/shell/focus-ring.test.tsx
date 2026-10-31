// @vitest-environment jsdom
/**
 * The keyboard focus ring. An outline follows the element's radius, so every control declares one.
 * The colour is a shell-written custom property with a literal fallback, since an unresolved `var()`
 * would leave the browser's black outline. Two tones, because controls stand on cream, the chosen
 * yellow, and island ground from sand to a layer-8 mountain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { EventBus } from '../../../core/commands/event-bus';
import { acquireOverlayLock } from '../../../platform/channels/overlay-state';
import type { EditorEvents } from '../../../state/editing/events';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { MenuSheet } from '../../../ui/shell/controls/MenuSheet';
import { Rail } from '../../../ui/shell/Rail';
import { Shell } from '../../../ui/shell/Shell';
import { ELEVATION_COLORS, ZONE_COLORS } from '../../../core/model/palette';
import { useFocusSource } from '../../../ui/design/focus-source';
import { ACTIVE, DARK_PLATE, FOCUS_HALO, FOCUS_RING, FOCUS_RING_FIELD, INK, INSET, PLATE } from '../../../ui/design/tokens';

/** The attribute `animations.css` selects the ring by, on the document element. */
const FOCUS_SOURCE_ATTR = 'data-focus-source';

const mountShell = () => render(<I18nProvider><Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell></I18nProvider>);

/** The literal the stylesheet falls back to, and the one it must keep carrying. */
const RING_FALLBACK = '#fb923c';

/** WCAG relative luminance and the contrast ratio over it, for two opaque hex colours. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const chan = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const css = readFileSync('src/ui/design/animations.css', 'utf8');

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, activeLayer: 4,
    displayLayer: null,
  });
});
afterEach(cleanup);

describe('the focus ring', () => {
  it('is a custom property, and every declaration of it carries the literal fallback', () => {
    // The control's ring and the one a text field moves to its wrapper, which reads
    // `--focus-ring-field` first.
    const rings = css.match(/outline: var\(--focus-width\) solid [^;]+;/g) ?? [];
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const ring of rings) {
      expect(ring.replace(' !important', '')).toMatch(
        new RegExp(`^outline: var\\(--focus-width\\) solid (var\\(--focus-ring-field, )?var\\(--focus-ring, ${RING_FALLBACK}\\)\\)?;$`),
      );
    }
    // The halo falls back to `transparent`, a valid colour, so the declaration still parses.
    expect(css).toMatch(/box-shadow: 0 0 0 var\(--control-clearance\) var\(--focus-halo, transparent\);/);
  });

  it('is this frame\'s own three colours for as long as the shell is mounted', () => {
    const vars = { '--focus-ring': FOCUS_RING, '--focus-halo': FOCUS_HALO, '--focus-ring-field': FOCUS_RING_FIELD };
    const root = document.documentElement;
    const shell = mountShell();
    for (const [name, value] of Object.entries(vars)) expect(root.style.getPropertyValue(name), name).toBe(value);
    shell.unmount();
    for (const name of Object.keys(vars)) expect(root.style.getPropertyValue(name), `${name} after unmount`).toBe('');
    // Distinct from the chosen yellow, since a chosen control can be focused, and from the ink.
    expect(FOCUS_RING).not.toBe(ACTIVE);
    expect(FOCUS_RING).not.toBe(INK);
  });

  /**
   * 3:1 is the WCAG ratio for a graphical indicator. The rust covers the pale surfaces, the halo the
   * dark ones; on the middle greens no colour clears 3, so the ring reads against its halo (next test).
   */
  it('is a rust for the pale surfaces and a cream for the dark ones', () => {
    const pale = { plate: PLATE, inset: INSET, chosen: ACTIVE, ...ZONE_COLORS, ground: ELEVATION_COLORS[0]! };
    for (const [name, bg] of Object.entries(pale)) {
      expect(contrast(FOCUS_RING, bg), `${name} (${bg})`).toBeGreaterThanOrEqual(3);
    }
    for (const layer of [6, 7, 8]) {
      const bg = ELEVATION_COLORS[layer]!;
      expect(contrast(FOCUS_HALO, bg), `layer ${layer} (${bg})`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(FOCUS_HALO, DARK_PLATE)).toBeGreaterThanOrEqual(3);
  });

  it('reads against itself, which is what carries it over the greens in between', () => {
    expect(contrast(FOCUS_RING, FOCUS_HALO)).toBeGreaterThanOrEqual(3);
    // One tone fails: the ink clears the plate but not the tallest mountain.
    expect(contrast(INK, PLATE)).toBeGreaterThanOrEqual(3);
    expect(contrast(INK, ELEVATION_COLORS[8]!)).toBeLessThan(3);
  });
});

/**
 * A browser matches `:focus-visible` on a clicked, still-focused control once any key goes down, so
 * the ring follows a stamp of what placed the focus. jsdom matches no `:focus-visible`, so the stamps
 * are checked here and the stylesheet must read them.
 */
describe('a ring is what the keyboard leaves behind, not what a key press summons', () => {
  const root = document.documentElement;
  let stop = () => {};
  const press = (type: string) => document.body.dispatchEvent(new Event(type, { bubbles: true }));
  const focus = () => press('focusin');

  /** The tracking as the shell mounts it, for as long as this stays mounted. */
  function Tracker() { useFocusSource(); return null; }
  beforeEach(() => { stop = render(<Tracker />).unmount; });
  afterEach(() => { stop(); });

  it('stamps what put the focus there, and a later key press does not restamp it', () => {
    press('pointerdown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');

    // Enter at a pointer-placed focus does not move the stamp.
    press('keydown');
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');

    // A Tab moves the focus, so the new focus is the keyboard's.
    press('keydown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('keyboard');

    press('pointerdown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');
  });

  it('a focus that no input put there is the page\'s own, and wears no ring', () => {
    // The tour card and modals take focus on mount, before any input: 'program', suppressed like a
    // pointer's, and a key pressed there restamps nothing.
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('program');
    press('keydown');
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('program');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('keyboard');
  });

  it('leaves the document as it found it', () => {
    press('pointerdown');
    focus();
    stop();
    stop = () => {};
    expect(root.hasAttribute(FOCUS_SOURCE_ATTR)).toBe(false);
    // The listeners leave with it.
    press('keydown');
    focus();
    expect(root.hasAttribute(FOCUS_SOURCE_ATTR)).toBe(false);
  });

  it('clears a keyboard ring when the same focused control is clicked', () => {
    render(<button>Mode</button>);
    const button = screen.getByRole('button', { name: 'Mode' });
    press('keydown');
    button.focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('keyboard');

    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.activeElement).toBe(button);
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');
  });

  it('cancels native Space activation on pointer-focused buttons without stopping held-key listeners', () => {
    render(<button>Mode</button>);
    const button = screen.getByRole('button', { name: 'Mode' });
    press('pointerdown');
    button.focus();
    let reachedWindow = false;
    const onKey = () => { reachedWindow = true; };
    window.addEventListener('keydown', onKey, { once: true });
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(reachedWindow).toBe(true);
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');
  });

  it('preserves Space activation after keyboard navigation and programmatic focus', () => {
    render(<><button>First</button><button>Second</button></>);
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    first.focus();
    const space = () => new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    const program = space();
    first.dispatchEvent(program);
    expect(program.defaultPrevented).toBe(false);

    press('pointerdown');
    first.focus();
    press('keydown');
    second.focus();
    const keyboard = space();
    second.dispatchEvent(keyboard);
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('keyboard');
    expect(keyboard.defaultPrevented).toBe(false);
  });

  it('preserves spaces in fields and Enter activation on pointer-focused buttons', () => {
    render(<><input aria-label="Title" /><button>Mode</button></>);
    const input = screen.getByRole('textbox');
    press('pointerdown');
    input.focus();
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    input.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);

    const button = screen.getByRole('button', { name: 'Mode' });
    press('pointerdown');
    button.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('leaves Space activation to a modal while it owns the keyboard', () => {
    render(<button>Confirm</button>);
    const button = screen.getByRole('button', { name: 'Confirm' });
    press('pointerdown');
    button.focus();
    const release = acquireOverlayLock();
    try {
      const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      release();
    }
  });

  it('has a rule that draws nothing for a pointer- or page-placed focus', () => {
    for (const source of ['pointer', 'program']) {
      const rule = css.match(new RegExp(`\\[data-focus-source='${source}'\\][^{]*\\{([^}]*)\\}`));
      expect(rule, `animations.css must suppress the ring for a ${source}-placed focus`).not.toBeNull();
      // The outline (`!important` against the controls' inline styles) and the halo.
      expect(rule![1]).toMatch(/outline:\s*none\s*!important;/);
      expect(rule![1]).toMatch(/box-shadow:\s*none;/);
    }
  });
});

describe('the shell stamps what placed the focus', () => {
  it('for as long as it is mounted', () => {
    const root = document.documentElement;
    const shell = mountShell();
    fireEvent.pointerDown(document.body);
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');
    shell.unmount();
    expect(root.hasAttribute(FOCUS_SOURCE_ATTR)).toBe(false);
  });
});

describe('every control in the frame declares the shape its ring follows', () => {
  it('the right-hand column, including each half of the layer plate', () => {
    render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(4);
    for (const b of buttons) {
      expect(b.style.borderRadius, b.getAttribute('aria-label') ?? '').not.toBe('');
    }
    // The plate does not clip: a clip there takes a focused step's ring with it.
    expect(screen.getByRole('button', { name: 'Add layer' }).parentElement!.style.overflow).toBe('');
  });

  it('the menu sheet\'s rows', () => {
    render(<I18nProvider><MenuSheet open onDismiss={() => {}} trigger={{ current: document.body.appendChild(document.createElement('button')) }} /></I18nProvider>);
    const rows = screen.getAllByRole('menuitem');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row as HTMLElement).style.borderRadius).not.toBe('');
  });
});
