/**
 * What separates a PANEL from the map.
 *
 * `frame-margins.test.ts` bans a shadow anywhere under `ui/shell`, and the panels the frame opens were
 * outside its reach: the five windows, the dropdown inside two of them and the dev-build notice
 * stand over the map but live in `ui/chrome`. The design source this frame is drawn from has no
 * gradient, no pattern, no layer effect and not one stroke, so a shadow was never in it. This is
 * that rule reaching the chrome panels.
 *
 * The edge itself is the third member of a family, not a new idea. A word standing on the map wears
 * a stroke (`MAP_LABEL`), a drawing wears a dilation (`SHAPE_EDGE_FILTER`), and both are the ink at
 * `MAP_EDGE_ALPHA`. A panel is a rectangle, so it wears the one thing a rectangle can: a border.
 * What has to hold is that the three read as one treatment, which is ink, alpha and weight.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../../../i18n/context';
import { MenuSheet } from '../../../ui/shell/windows/MenuSheet';
import { cozyPanel, windowMenu } from '../../../ui/design/window-skin';
import {
  INK, MAP_EDGE_ALPHA, MAP_LABEL, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE, SHAPE_EDGE,
} from '../../../ui/design/tokens';
import { ZONE_COLORS } from '../../../core/model/constants';

const notice = readFileSync('src/ui/chrome/guards/DevBuildNotice.tsx', 'utf8');

/** WCAG relative luminance and the contrast ratio over it, for two opaque `rgb` triples. */
function luminance([r, g, b]: readonly [number, number, number]): number {
  const chan = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
}
function rgb(hex: string): readonly [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as unknown as [number, number, number];
}
/** `over` composited under `ink` at `alpha`, which is what a translucent border actually shows:
 *  a background paints under its own border area, so the line is drawn on the plate. */
function composite(ink: string, alpha: number, over: string): readonly [number, number, number] {
  const [a, b] = [rgb(ink), rgb(over)];
  return [0, 1, 2].map((i) => alpha * a[i]! + (1 - alpha) * b[i]!) as unknown as [number, number, number];
}
function contrast(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

afterEach(cleanup);

describe('the edge a panel wears', () => {
  it('is the ink and the alpha a word and a drawing on the map already wear', () => {
    const alphaHex = Math.round(MAP_EDGE_ALPHA * 255).toString(16).padStart(2, '0');
    expect(PANEL_EDGE).toBe(`${PANEL_EDGE_WIDTH}px solid ${INK}${alphaHex}`);
    // The word's own stroke names the same two, so the family is one value in three places rather
    // than three values that happen to agree today.
    expect(MAP_LABEL.WebkitTextStroke).toContain(`${INK}${alphaHex}`);
  });

  /**
   * The two weights are the same weight, in the only sense each can express.
   *
   * A dilation grows an alpha, so its boundary lands wherever the ramp crosses its threshold and
   * the ink there is the full 62%. A border is a drawn line: at half a pixel it rasterizes to one
   * row of half coverage, so the panel would read at 31% beside every word and drawing at 62%.
   * 1 px is the thinnest a border carries the family's ink at the family's strength, and the ceiling
   * is what the owner rejected — the prototype's 3 px is a keyline, not a shading.
   */
  it('is thin: one drawn pixel, where the dilation reaches half of one', () => {
    expect(PANEL_EDGE_WIDTH).toBe(1);
    expect(PANEL_EDGE_WIDTH).toBeGreaterThanOrEqual(2 * SHAPE_EDGE);
    expect(PANEL_EDGE_WIDTH).toBeLessThan(2);
  });

  it('reads as a line on the plate it is drawn on, which is where it is faintest', () => {
    // 3:1, the ratio a graphical indicator is read at, same as the focus ring's.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(PLATE))).toBeGreaterThanOrEqual(3);
    // And it is a boundary against the background that gave the plate none: an empty sea, where
    // cream on pale blue is the case a shadow used to answer.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(ZONE_COLORS[0]!)))
      .toBeGreaterThan(contrast(rgb(PLATE), rgb(ZONE_COLORS[0]!)));
  });
});

describe('a chrome panel standing on the map wears it too', () => {
  const SHARED: readonly [name: string, style: { border?: unknown; boxShadow?: unknown }][] = [
    ['the modal card', cozyPanel],
    ['the dropdown', windowMenu],
  ];

  it.each(SHARED)('%s takes the edge and casts nothing', (_name, style) => {
    expect(style.border).toBe(PANEL_EDGE);
    expect(style.boxShadow).toBe('none');
  });

  it('and so does the dev-build notice, which is not a window but stands on the map like one', () => {
    expect(notice).toContain('border: PANEL_EDGE');
    expect(notice).toContain("boxShadow: 'none'");
  });
});

describe('the panels that belong to the game frame alone wear the edge outright', () => {
  /** The token as the DOM gives it back: jsdom re-serializes an 8-digit hex to `rgba()`, so the
   *  string cannot be compared to the token's own spelling. */
  const [r, g, b] = rgb(INK);
  const asRendered = `${PANEL_EDGE_WIDTH}px solid rgba(${r}, ${g}, ${b}, ${MAP_EDGE_ALPHA})`;

  it('the menu sheet', () => {
    render(<I18nProvider><MenuSheet open onDismiss={() => {}} /></I18nProvider>);
    expect(screen.getByRole('menu').style.border).toBe(asRendered);
  });
});
