import { describe, it, expect, vi } from 'vitest';
import { CURSORS, CURSOR_IDS, CURSOR_SIZE, FORBIDDABLE } from '../../ui/cursors/cursor-spec';
import { cursorSvg } from '../../ui/cursors/cursor-art';
import { colors } from '../../ui/styles';
import { ELEVATION_COLORS, WATER_COLOR } from '../../core/model/constants';

vi.mock('../../ui/cursors/cursor-art', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/cursors/cursor-art')>();
  // Wraps the real implementation, so the art tests in this file still exercise it; the spy is
  // only there for the memo test to count rebuilds.
  return { ...actual, cursorSvg: vi.fn(actual.cursorSvg) };
});

// Keyword cursors a browser is guaranteed to understand: what the user gets if our image or
// hotspot is ever rejected.
const KEYWORDS = ['default', 'crosshair', 'grab', 'grabbing', 'move', 'copy', 'progress', 'not-allowed', 'pointer', 'all-scroll', 'text'];

describe('cursor catalogue', () => {
  it('describes every id exactly once', () => {
    expect(CURSOR_IDS.length).toBe(new Set(CURSOR_IDS).size);
    expect(Object.keys(CURSORS).sort()).toEqual([...CURSOR_IDS].sort());
  });

  it('puts every hotspot inside the image', () => {
    for (const id of CURSOR_IDS) {
      const [x, y] = CURSORS[id].hotspot;
      expect(Number.isInteger(x) && Number.isInteger(y), id).toBe(true);
      expect(x >= 0 && x < CURSOR_SIZE, `${id} hotspot x`).toBe(true);
      expect(y >= 0 && y < CURSOR_SIZE, `${id} hotspot y`).toBe(true);
    }
  });

  it('gives every id a real keyword fallback', () => {
    for (const id of CURSOR_IDS) expect(KEYWORDS, id).toContain(CURSORS[id].fallback);
  });

  it('marks busy as keyword-only, since a spinner cursor is the OS\'s job', () => {
    expect(CURSORS.busy.hasArt).toBe(false);
    expect(CURSORS.busy.fallback).toBe('progress');
    for (const id of CURSOR_IDS.filter((i) => i !== 'busy')) expect(CURSORS[id].hasArt, id).toBe(true);
  });

  it('only lets cursors whose tool can ANSWER carry the forbidden badge', () => {
    // Panning, orbiting, marquee and busy are always legal, and `select` means "nothing here to act
    // on", which is not a refusal. `move` and `edge-cut` cannot answer at hover time either: a
    // move's only refusable fact is the drop cell, unknown until the drag ends, and cut validity is
    // per-CORNER, so there is no single answer for the cell under the pointer. The DOM four are not
    // tool cursors at all, and `blocked` draws the badge itself.
    for (const id of ['hand-open', 'hand-closed', 'orbit', 'marquee', 'busy', 'select', 'move', 'edge-cut',
      'default', 'clickable', 'blocked', 'text'] as const) {
      expect(FORBIDDABLE.has(id), id).toBe(false);
    }
    for (const id of ['mountain', 'water', 'road', 'eraser', 'place'] as const) {
      expect(FORBIDDABLE.has(id), id).toBe(true);
    }
  });
});

describe('cursor art', () => {
  const MOUNTAIN = ELEVATION_COLORS[3]!;

  it('draws every id that claims art, at the catalogue size', () => {
    for (const id of CURSOR_IDS) {
      const svg = cursorSvg(id);
      if (!CURSORS[id].hasArt) { expect(svg, id).toBeNull(); continue; }
      expect(svg, id).toContain(`viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}"`);
      expect(svg, id).toContain(`width="${CURSOR_SIZE}"`);
      expect(svg!.startsWith('<svg'), id).toBe(true);
      expect(svg!.trimEnd().endsWith('</svg>'), id).toBe(true);
    }
  });

  it('adds the forbidden badge only when asked', () => {
    const plain = cursorSvg('mountain')!;
    const barred = cursorSvg('mountain', { forbidden: true })!;
    expect(plain).not.toContain(colors.statusError);
    expect(barred).toContain(colors.statusError);
    expect(barred.length).toBeGreaterThan(plain.length);
    // A keyword-only cursor has nothing to badge.
    expect(cursorSvg('busy', { forbidden: true })).toBeNull();
  });

  it('never stamps a second badge on art that already refuses', () => {
    // `blocked` IS the arrow-plus-badge, so asking it for `forbidden` must be a no-op rather
    // than drawing two circle-slashes on top of each other.
    expect(cursorSvg('blocked', { forbidden: true })).toBe(cursorSvg('blocked'));
    expect(cursorSvg('blocked')).toContain(colors.statusError);
  });

  it('draws `default` and `select` from one arrow, so the pointer has a single identity', () => {
    const arrow = cursorSvg('select')!;
    expect(cursorSvg('default')).toBe(arrow);
    // …and `blocked` is that same arrow with the refusal badge added, not a second arrow.
    expect(cursorSvg('blocked')!.startsWith(arrow.slice(0, arrow.indexOf('</svg>')))).toBe(true);
  });

  it('takes material colours from the palette the map draws with', () => {
    expect(cursorSvg('mountain')).toContain(MOUNTAIN);
    expect(cursorSvg('water')).toContain(WATER_COLOR);
  });

  it('uses palette tokens, never a literal hex of its own', () => {
    const allowed = new Set([
      colors.frameDark, colors.panelCream, colors.statusError,
      MOUNTAIN, WATER_COLOR, '#c4a882',
    ].map((c) => c.toLowerCase()));
    for (const id of CURSOR_IDS) {
      for (const hex of cursorSvg(id, { forbidden: true })?.match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
        expect(allowed, `${id} uses an unlisted colour ${hex}`).toContain(hex.toLowerCase());
      }
    }
  });

  it('tells the user what a Ctrl+click will do', () => {
    // Without these, holding Ctrl looks identical to not holding it.
    expect(cursorSvg('select-add')).toContain(colors.frameDark);
    expect(CURSORS['select-add'].hotspot).toEqual([2, 2]);
    expect(CURSORS['select-remove'].hotspot).toEqual([2, 2]);
    expect(FORBIDDABLE.has('select-add')).toBe(false);
    expect(FORBIDDABLE.has('select-remove')).toBe(false);
    expect(cursorSvg('select-add')).not.toBe(cursorSvg('select-remove'));
    // Both compose the same pointer arrow `select` draws, badged like `blocked` is — the same
    // apex, the same identity, just a different mark in the corner.
    const arrow = cursorSvg('select')!;
    expect(cursorSvg('select-add')!.startsWith(arrow.slice(0, arrow.indexOf('</svg>')))).toBe(true);
    expect(cursorSvg('select-remove')!.startsWith(arrow.slice(0, arrow.indexOf('</svg>')))).toBe(true);
  });
});

describe('cursor CSS', () => {
  it('is a data-URI image, a hotspot, and a keyword fallback', async () => {
    const { cursorCss } = await import('../../ui/cursors/cursor-css');
    const css = cursorCss('mountain');
    expect(css.startsWith('url("data:image/svg+xml,')).toBe(true);
    const [, hx, hy, fallback] = /"\)\s+(\d+)\s+(\d+),\s*([a-z-]+)$/.exec(css)!;
    expect([Number(hx), Number(hy)]).toEqual([...CURSORS.mountain.hotspot]);
    expect(fallback).toBe(CURSORS.mountain.fallback);
  });

  it('never emits a bare url(), for every id', async () => {
    const { cursorCss } = await import('../../ui/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      const css = cursorCss(id).trimEnd();
      if (CURSORS[id].hasArt) {
        // A closed url(), then the hotspot, then the mandatory keyword. An unclosed url()
        // makes the whole declaration invalid and the element gets no cursor at all.
        expect(css, id).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\)\s+\d+\s+\d+,\s*[a-z-]+$/);
      } else {
        // Keyword-only: the value IS the fallback, exactly.
        expect(css, id).toBe(CURSORS[id].fallback);
      }
    }
  });

  it('returns the keyword alone for a keyword-only cursor', async () => {
    const { cursorCss } = await import('../../ui/cursors/cursor-css');
    expect(cursorCss('busy')).toBe('progress');
  });

  it('encodes the SVG, so a hex colour cannot truncate the URI', async () => {
    const { cursorCss } = await import('../../ui/cursors/cursor-css');
    for (const id of CURSOR_IDS) {
      const css = cursorCss(id, { forbidden: true });
      const uri = /url\("([^"]*)"\)/.exec(css)?.[1];
      if (!uri) continue;
      expect(uri, id).not.toContain('#');
      expect(uri, id).toContain('%23'); // the encoded form is present instead
      expect(() => decodeURIComponent(uri.replace('data:image/svg+xml,', '')), id).not.toThrow();
    }
  });

  it('memoises, so a pointer-move cannot rebuild a data URI', async () => {
    const { cursorCss, __clearCursorCssCache } = await import('../../ui/cursors/cursor-css');
    const { cursorSvg } = await import('../../ui/cursors/cursor-art');
    const spy = vi.mocked(cursorSvg);
    __clearCursorCssCache();
    spy.mockClear();
    cursorCss('water');
    cursorCss('water');
    expect(spy).toHaveBeenCalledTimes(1); // the second call came from the cache
    cursorCss('water', { forbidden: true });
    expect(spy).toHaveBeenCalledTimes(2); // a different key is a different entry
  });
});
