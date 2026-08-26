/**
 * The sprite is the design artifact's own drawing set, and this suite holds it to that: every symbol
 * the artifact declares is mounted, every id the union names is drawn, and nothing paints a colour
 * of its own (the monochrome rule: ink through `currentColor`, accents cut as knockouts).
 *
 * The artifact's ids are READ from the artifact rather than typed here, so a drawing added there and
 * not carried over fails as a missing symbol instead of passing quietly. The design source is not
 * part of the published tree, so the reading tests skip where it is absent.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
import { Icon, IconSprite, type IconId } from '../../../ui/agent/icons';

const ARTIFACT = 'docs/internal/superpowers/specs/2026-08-21-agent-v3-panel-final.html';
const HAVE_ARTIFACT = existsSync(ARTIFACT);

/** Every `<symbol>` the artifact's sprite block declares, in its own order. */
function artifactSymbolIds(): string[] {
  const html = readFileSync(ARTIFACT, 'utf8');
  return [...html.matchAll(/<symbol[^>]*id="(pw-[a-z0-9-]+)"/g)].map((m) => m[1]);
}

/**
 * DRAWINGS THIS INTERFACE NEEDS THAT THE ARTIFACT DOES NOT DRAW, admitted here rather than passing
 * quietly: the reading tests exclude them, so a drawing that IS in the artifact and was not carried
 * over still fails. An id earns a place here only where the artifact has nothing to carry over — the
 * two dock glyphs are the dock controls', one per end of the window, and docking the panel is a
 * feature ruled after the artifact was drawn.
 */
const BEYOND_THE_ARTIFACT: readonly string[] = ['pw-dock-left', 'pw-dock-right'];

/**
 * Every id the `IconId` union names, as a runtime list (a type cannot be iterated). `tsc` fails the
 * annotation if an entry is not in the union; the completeness test below is what catches the other
 * direction.
 */
const ICON_IDS: IconId[] = [
  'pw-terrain-raise', 'pw-terrain-lower', 'pw-water', 'pw-river', 'pw-road', 'pw-bridge',
  'pw-ramp', 'pw-object-place', 'pw-object-remove', 'pw-rotate', 'pw-trim-corner', 'pw-clear',
  'pw-scatter', 'pw-forest', 'pw-decorate', 'pw-generator', 'pw-inspect', 'pw-evaluate',
  'pw-search-sites', 'pw-skill', 'pw-plan', 'pw-subagent', 'pw-export', 'pw-snapshot',
  'pw-settings', 'pw-history', 'pw-region-frame', 'pw-key', 'pw-link-out', 'pw-send', 'pw-stop',
  'pw-pause', 'pw-resume', 'pw-check', 'pw-cross', 'pw-skip-forward', 'pw-undo-arrow',
  'pw-rewind', 'pw-take-back', 'pw-chevron', 'pw-drag-handle', 'pw-warning', 'pw-retry-clock',
  'pw-plug', 'pw-question', 'pw-tick-ok', 'pw-tick-run', 'pw-tick-revert', 'pw-tick-error',
  'pw-shield', 'pw-shield-hold', 'pw-flag', 'pw-disconnected', 'pw-compress', 'pw-wallet',
  'pw-cloud-off', 'pw-lock', 'pw-lightning', 'pw-dock-left', 'pw-dock-right', 'pw-eraser',
  'pw-terrace-steps',
  'pw-reply-bubble', 'pw-note', 'pw-badge-zzz', 'pw-badge-pause', 'pw-badge-exclaim', 'pw-badge-spark',
  'pw-badge-note',
];

describe('IconSprite', () => {
  it.skipIf(!HAVE_ARTIFACT)('mounts every symbol the design artifact declares', () => {
    const { container } = render(<IconSprite />);
    const mounted = [...container.querySelectorAll('symbol')]
      .map((s) => s.getAttribute('id'))
      .filter((id) => id !== null && !BEYOND_THE_ARTIFACT.includes(id));
    expect(mounted).toEqual(artifactSymbolIds());
  });

  it.skipIf(!HAVE_ARTIFACT)('names each of them in the IconId union, and nothing else', () => {
    const named = ICON_IDS.filter((id) => !BEYOND_THE_ARTIFACT.includes(id));
    expect([...named].sort()).toEqual([...artifactSymbolIds()].sort());
  });

  it('defines every id the IconId union names', () => {
    const { container } = render(<IconSprite />);
    for (const id of ICON_IDS) {
      expect(container.querySelector(`symbol#${id}`), id).not.toBeNull();
    }
  });

  it('paints in ink alone: every fill and stroke is currentColor or none', () => {
    const { container } = render(<IconSprite />);
    const offenders: string[] = [];
    for (const symbol of container.querySelectorAll('symbol')) {
      for (const node of symbol.querySelectorAll('[fill],[stroke]')) {
        // A mask is plumbing, not paint: its black/white is which pixels survive.
        if (node.closest('mask')) continue;
        for (const attr of ['fill', 'stroke']) {
          const value = node.getAttribute(attr);
          if (value && value !== 'currentColor' && value !== 'none') {
            offenders.push(`${symbol.getAttribute('id')}: ${attr}="${value}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders hidden, so a <use> elsewhere still resolves it', () => {
    const { container } = render(<IconSprite />);
    const svg = container.querySelector('svg')!;
    expect(svg.style.display).toBe('none');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Icon', () => {
  it('renders a <use> referencing the sprite, sized and aria-hidden', () => {
    const { container } = render(<Icon id="pw-check" size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const use = container.querySelector('use')!;
    expect(use.getAttribute('href')).toBe('#pw-check');
  });

  it('defaults to size 15, the artifact ic() default', () => {
    const { container } = render(<Icon id="pw-check" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('height')).toBe('15');
  });
});
