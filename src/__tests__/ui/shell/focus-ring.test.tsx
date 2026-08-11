/**
 * The ring a control wears while the keyboard is on it.
 *
 * An outline follows the element's own `border-radius`, so a control whose shape is ART inside a
 * bare button box is ringed as that box: a rectangle around a round plate, a rectangle standing
 * outside the yellow plate that already marks the chosen mode. Every focusable control in this frame
 * therefore declares the shape its ring should take, and the two facts below are what keep that
 * true, since jsdom lays nothing out and a missing radius is invisible to every other test here.
 *
 * A stylesheet cannot read a token module, so the colour arrives as a custom property the shell
 * writes onto the document. The assertions on the stylesheet are what keep a LITERAL fallback in
 * every ring declaration: an unresolved `var()` with no fallback invalidates the whole declaration,
 * so a document that has not run the shell's effect yet would not lose the colour but the ring —
 * back to the browser's own black outline, which belongs to no interface.
 *
 * THE RING IS TWO TONES BECAUSE ONE CANNOT DO IT. A control in this frame can stand on a cream
 * plate, on the yellow that marks a chosen one, or on bare island, and that last one runs from sand
 * to a layer-8 mountain. The contrast test below is the arithmetic that says so: it fails a ring
 * that is dark enough for the plate and lost on the mountains, which is what the ink was.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { MenuSheet } from '../../../ui/shell/windows/MenuSheet';
import { Rail } from '../../../ui/shell/Rail';
import { ELEVATION_COLORS, ZONE_COLORS } from '../../../core/model/constants';
import { FOCUS_SOURCE_ATTR, trackFocusSource } from '../../../ui/design/focus-source';
import { ACTIVE, DARK_PLATE, FOCUS_HALO, FOCUS_RING, INK, INSET, PLATE } from '../../../ui/design/tokens';

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
const shell = readFileSync('src/ui/shell/Shell.tsx', 'utf8');

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, activeLayer: 4,
    displayLayer: null,
  });
});
afterEach(cleanup);

describe('the focus ring', () => {
  it('is a custom property, and every declaration of it carries the literal fallback', () => {
    // The control's own ring, and the one a text field moves up to its wrapper. The field's reads a
    // variable of its own FIRST, so that question can be answered separately, and falls through to
    // the same two.
    const rings = css.match(/outline: 3px solid [^;]+;/g) ?? [];
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const ring of rings) {
      expect(ring.replace(' !important', '')).toMatch(
        new RegExp(`^outline: 3px solid (var\\(--focus-ring-field, )?var\\(--focus-ring, ${RING_FALLBACK}\\)\\)?;$`),
      );
    }
    // The halo is the one that falls back to nothing: a second ring is this frame's own idea, and
    // `transparent` is a valid colour, so the declaration still parses where none is named.
    expect(css).toMatch(/box-shadow: 0 0 0 7px var\(--focus-halo, transparent\);/);
  });

  it('is this frame\'s own three colours for as long as the shell is mounted', () => {
    for (const name of ['--focus-ring', '--focus-halo', '--focus-ring-field']) {
      expect(shell).toContain(`setProperty('${name}'`);
      expect(shell).toContain(`removeProperty('${name}')`);
    }
    // Not the yellow that marks a choice: a control can be focused while it is chosen, and the two
    // have to stay separate facts.
    expect(FOCUS_RING).not.toBe(ACTIVE);
    // Not the ink either, which is the interface's black-reading brown and what this replaced.
    expect(FOCUS_RING).not.toBe(INK);
  });

  /**
   * What the two tones are each for. 3:1 is the ratio a graphical indicator is read at.
   *
   * The rust holds everything PALE — every plate, the yellow that marks a chosen control, and the
   * ground the island is drawn on. The halo holds everything DARK: the dark plate and the top of
   * the mountain ramp. Between them lie the middle greens, where neither clears 3 and no colour
   * would; there the ring is read against ITSELF, which is the next test.
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
    // And why one tone was never going to do: the ink cleared the plate at 8 and was lost on the
    // tallest mountain, which is the pair of numbers this replaced.
    expect(contrast(INK, PLATE)).toBeGreaterThanOrEqual(3);
    expect(contrast(INK, ELEVATION_COLORS[8]!)).toBeLessThan(3);
  });
});

/**
 * THE RING IS DRAWN ONLY WHERE THE KEYBOARD PUT THE FOCUS.
 *
 * A browser matches `:focus-visible` on the element that is already focused as soon as any key goes
 * down, and a control in this frame is focused by the click that chose it and then stays focused. So
 * pressing Enter, or that control's own shortcut, used to draw the rust ring around a control the
 * yellow plate already marks as chosen: two boxes, the outer one earned by a key press that had
 * nothing to do with the control under it. Reproduced in a browser at 4x before this was written.
 *
 * jsdom neither lays out nor matches `:focus-visible`, so the guard is in two halves and each states
 * what it can prove: the SEQUENCE below is the whole of the module's behaviour, and the stylesheet
 * assertion is what keeps a rule that reads its stamp.
 */
describe('a ring is what the keyboard leaves behind, not what a key press summons', () => {
  const root = document.documentElement;
  let stop = () => {};
  const press = (type: string) => document.body.dispatchEvent(new Event(type, { bubbles: true }));
  const focus = () => press('focusin');

  beforeEach(() => { stop = trackFocusSource(); });
  afterEach(() => { stop(); });

  it('stamps what put the focus there, and a later key press does not restamp it', () => {
    press('pointerdown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');

    // The defect: Enter at a standing pointer-placed focus. The stamp must not move, because the
    // focus did not.
    press('keydown');
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');

    // A Tab moves the focus itself, so the next one is the keyboard's and wears its ring.
    press('keydown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('keyboard');

    // And back: a pointer press before the next focus hands it over again.
    press('pointerdown');
    focus();
    expect(root.getAttribute(FOCUS_SOURCE_ATTR)).toBe('pointer');
  });

  it('leaves the document as it found it', () => {
    press('pointerdown');
    focus();
    stop();
    stop = () => {};
    expect(root.hasAttribute(FOCUS_SOURCE_ATTR)).toBe(false);
    // The listeners are gone with it: a stamp after the stop would mean a second shell's tracking
    // outliving the first.
    press('keydown');
    focus();
    expect(root.hasAttribute(FOCUS_SOURCE_ATTR)).toBe(false);
  });

  it('has a rule that draws nothing for a pointer-placed focus, and the shell mounts the tracking', () => {
    const rule = css.match(/\[data-focus-source='pointer'\] \*:focus-visible \{([^}]*)\}/);
    expect(rule, 'animations.css must suppress the ring for a pointer-placed focus').not.toBeNull();
    // Both halves of the ring: the outline, whose own declaration is `!important` against the
    // controls' inline styles, and the halo outside it.
    expect(rule![1]).toMatch(/outline:\s*none\s*!important;/);
    expect(rule![1]).toMatch(/box-shadow:\s*none;/);
    expect(shell).toContain('useFocusSource()');
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
    render(<I18nProvider><MenuSheet open onDismiss={() => {}} /></I18nProvider>);
    const rows = screen.getAllByRole('menuitem');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect((row as HTMLElement).style.borderRadius).not.toBe('');
  });
});
