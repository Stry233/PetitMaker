// @vitest-environment jsdom
/** Public icon contract: every runtime id draws, the shared marks from the interface's one set, and
 *  visible paint inherits `currentColor`. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, IconSprite, type IconId, type SetMarkId } from '../../../ui/agent/parts/sprite';
import { CheckIcon, ChevronIcon, CloseIcon, ExternalLinkIcon, QuestionIcon, WarningIcon } from '../../../ui/primitives/line-glyphs';

/** The panel's names for the set's marks, with the mark each must draw. */
const SET_MARKS: Record<SetMarkId, () => JSX.Element> = {
  'pw-check': () => <CheckIcon size={15} />,
  'pw-cross': () => <CloseIcon size={15} />,
  'pw-chevron': () => <ChevronIcon size={15} />,
  'pw-question': () => <QuestionIcon size={15} />,
  'pw-warning': () => <WarningIcon size={15} />,
  'pw-link-out': () => <ExternalLinkIcon size={15} />,
};

/**
 * Every id the sprite draws, as a runtime list (a type cannot be iterated). `tsc` fails the
 * annotation if an entry is not in the union; the completeness test below is what catches the other
 * direction.
 */
const ICON_IDS: Exclude<IconId, SetMarkId>[] = [
  'pw-terrain-raise', 'pw-terrain-lower', 'pw-water', 'pw-river', 'pw-road', 'pw-bridge',
  'pw-ramp', 'pw-object-place', 'pw-object-remove', 'pw-rotate', 'pw-trim-corner', 'pw-clear',
  'pw-scatter', 'pw-forest', 'pw-decorate', 'pw-generator', 'pw-inspect', 'pw-evaluate',
  'pw-search-sites', 'pw-skill', 'pw-plan', 'pw-subagent', 'pw-export', 'pw-snapshot',
  'pw-settings', 'pw-history', 'pw-region-frame', 'pw-key', 'pw-send', 'pw-stop',
  'pw-pause', 'pw-resume', 'pw-skip-forward', 'pw-undo-arrow',
  'pw-rewind', 'pw-take-back', 'pw-drag-handle', 'pw-retry-clock',
  'pw-plug', 'pw-tick-ok', 'pw-tick-run', 'pw-tick-revert', 'pw-tick-error',
  'pw-shield', 'pw-shield-hold', 'pw-flag', 'pw-disconnected', 'pw-compress', 'pw-wallet',
  'pw-cloud-off', 'pw-lock', 'pw-lightning', 'pw-dock-left', 'pw-dock-right', 'pw-eraser',
  'pw-terrace-steps',
  'pw-reply-bubble', 'pw-note', 'pw-badge-zzz', 'pw-badge-pause', 'pw-badge-exclaim', 'pw-badge-spark',
  'pw-badge-note',
];

describe('IconSprite', () => {
  it('defines every id the sprite draws', () => {
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
  it('draws a shared mark from the interface\'s one icon set, not a second drawing', () => {
    for (const [id, Mark] of Object.entries(SET_MARKS) as [SetMarkId, () => JSX.Element][]) {
      const drawn = render(<Icon id={id} />).container.innerHTML;
      expect(drawn, id).toBe(render(<Mark />).container.innerHTML);
      expect(drawn, id).not.toContain('<use');
    }
  });

  it('renders a <use> referencing the sprite, sized and aria-hidden', () => {
    const { container } = render(<Icon id="pw-key" size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const use = container.querySelector('use')!;
    expect(use.getAttribute('href')).toBe('#pw-key');
  });

  it('defaults to size 15', () => {
    const { container } = render(<Icon id="pw-key" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('height')).toBe('15');
  });
});
