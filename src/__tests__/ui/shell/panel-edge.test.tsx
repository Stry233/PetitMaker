// @vitest-environment jsdom
/**
 * What separates a panel from the map. `frame-margins.test.ts` bans shadows under `ui/shell`; this
 * extends the rule to the panels in `ui/chrome` that stand over the map (the five windows and the
 * dev-build notice), since the design source has no shadow, gradient or stroke.
 *
 * The edge is the third of a family: a word on the map wears a stroke (`MAP_LABEL`), a drawing a
 * dilation (`SHAPE_EDGE_FILTER`), a panel a border, all in the same ink, `MAP_EDGE_ALPHA` and weight.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { MenuSheet } from '../../../ui/shell/controls/MenuSheet';
import { NoticeBar } from '../../../ui/primitives/NoticeBar';
import { cozyPanel } from '../../../ui/design/window-skin';
import {
  INK, MAP_EDGE_ALPHA, MAP_LABEL, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE,
} from '../../../ui/design/tokens';
import { ZONE_COLORS } from '../../../core/model/palette';


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
   * 1 px is the thinnest a border carries the family's ink at the family's strength, and 3 px reads
   * as a keyline rather than a shading.
   */
  it('is thin: one drawn pixel, where the dilation reaches half of one', () => {
    expect(PANEL_EDGE_WIDTH).toBe(1);
    // The map edge filter grows a drawing by half a css px.
    expect(PANEL_EDGE_WIDTH).toBeGreaterThanOrEqual(2 * 0.5);
    expect(PANEL_EDGE_WIDTH).toBeLessThan(2);
  });

  it('reads as a line on the plate it is drawn on, which is where it is faintest', () => {
    // 3:1, the ratio a graphical indicator is read at, same as the focus ring's.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(PLATE))).toBeGreaterThanOrEqual(3);
    // And it is a boundary against the background that gave the plate none: an empty sea, where
    // cream on pale blue is the case a shadow would otherwise answer.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(ZONE_COLORS[0]!)))
      .toBeGreaterThan(contrast(rgb(PLATE), rgb(ZONE_COLORS[0]!)));
  });
});

describe('a chrome panel standing on the map wears it too', () => {
  const SHARED: readonly [name: string, style: { border?: unknown; boxShadow?: unknown }][] = [
    ['the modal card', cozyPanel],
  ];

  it.each(SHARED)('%s takes the edge and casts nothing', (_name, style) => {
    expect(style.border).toBe(PANEL_EDGE);
    expect(style.boxShadow).toBe('none');
  });

  it('and so does the dev-build notice, which is not a window but stands on the map like one', () => {
    // The dev-build notice is drawn on the shared notice card.
    render(<NoticeBar data-testid="notice" edge="bottom" offset={16}><span>words</span></NoticeBar>);
    const card = screen.getByTestId('notice');
    const edge = document.createElement('div');
    edge.style.border = PANEL_EDGE;
    expect(edge.style.border, 'the edge parses as a border').not.toBe('');
    expect(card.style.border).toBe(edge.style.border);
    expect(card.style.boxShadow).toBe('none');
  });
});

describe('the panels that belong to the game frame alone wear the edge outright', () => {
  /** The token as the DOM gives it back: jsdom re-serializes an 8-digit hex to `rgba()`, so the
   *  string cannot be compared to the token's own spelling. */
  const [r, g, b] = rgb(INK);
  const asRendered = `${PANEL_EDGE_WIDTH}px solid rgba(${r}, ${g}, ${b}, ${MAP_EDGE_ALPHA})`;

  it('the menu sheet', () => {
    render(<I18nProvider><MenuSheet open onDismiss={() => {}} trigger={{ current: document.body.appendChild(document.createElement('button')) }} /></I18nProvider>);
    expect(screen.getByRole('menu').style.border).toBe(asRendered);
  });
});
