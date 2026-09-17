import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';

describe('scrollbars', () => {
  // Prose in comments names the properties; only rules are under test.
  const css = (readFileSync('src/ui/design/animations.css', 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '');

  it('draws the rounded thumb from the pseudo-elements on every device', () => {
    const outsideMedia = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '').replace(/@supports[^{]*\{[\s\S]*?\n\}/g, '');
    expect(outsideMedia).toContain('::-webkit-scrollbar-thumb');
    expect(outsideMedia).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius: 999px/);
  });

  it('keeps the standard properties for engines without the pseudo-elements, since Chromium drops the pseudo-elements once either is set', () => {
    const standardOnly = css.match(/@supports not selector\(::-webkit-scrollbar\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(standardOnly).toContain('scrollbar-color');
    expect(standardOnly).toContain('scrollbar-width: thin');
    const elsewhere = css.replace(/@supports not selector\(::-webkit-scrollbar\)\s*\{[\s\S]*?\n\}/, '');
    expect(elsewhere).not.toContain('scrollbar-color');
    expect(elsewhere).not.toMatch(/scrollbar-width: (thin|auto)/);
  });

  it('narrows the bar on a coarse pointer, where it is always visible', () => {
    const coarse = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(coarse).toMatch(/::-webkit-scrollbar\s*\{[^}]*width: 8px/);
  });
});

describe('tap feedback', () => {
  it('draws no platform tap halo over the interface', () => {
    const css = readFileSync('src/ui/design/animations.css', 'utf8') as string;
    const rule = css.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('-webkit-tap-highlight-color: transparent');
  });
});
