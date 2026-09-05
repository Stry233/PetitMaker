/**
 * The prompt compiler assembles role labels for the images actually sent, the preserve-list
 * contract, the direction's own language and the scene's own clauses into one deterministic string.
 */
import { describe, it, expect } from 'vitest';
import { STYLE_PACKS, CUSTOM_DIRECTION_ID } from '../../../io/stylize/presets';
import { BASE_CONTRACT } from '../../../io/stylize/prompt';
import { compilePrompt } from '../../../io/stylize/prompt/compile';

const watercolor = STYLE_PACKS.find((p) => p.id === 'watercolor')!;

describe('compilePrompt', () => {
  it('a watercolor compile with all roles carries the role labels, contract, fragment and present-category clauses', () => {
    const scene = ['a river runs north to south across the map', 'a lake spreads across the northwest'];
    const plan = compilePrompt({
      direction: 'watercolor',
      scene,
      presentCategories: new Set(['building', 'road']),
      images: { source: true, style: 'pack' as const, layout: true },
    });

    expect(plan.text).toContain('The last image is the planning map to redraw.');
    expect(plan.text).toContain('Image 1 is a style sample');
    expect(plan.text).toContain('flat-color layout legend');
    expect(plan.text).toContain(BASE_CONTRACT);
    expect(plan.text).toContain(watercolor.fragment);
    expect(plan.text).toContain(watercolor.elementStyles.building!);
    expect(plan.text).toContain(watercolor.elementStyles.road!);
    // plant/water-feature are not present on this map: their clauses must not appear.
    expect(plan.text).not.toContain(watercolor.elementStyles.plant!);
    expect(plan.text).not.toContain(watercolor.elementStyles['water-feature']!);
    for (const clause of scene) expect(plan.text).toContain(clause);
    expect(plan.text).not.toContain('undefined');
    expect(plan.text).not.toMatch(/\s$/);
  });

  it('custom with text carries the text and no pack fragment', () => {
    const plan = compilePrompt({
      direction: CUSTOM_DIRECTION_ID,
      customText: 'soft pencil sketch, cream paper',
      scene: [],
      presentCategories: new Set(),
      images: { source: true },
    });

    expect(plan.text).toContain('soft pencil sketch, cream paper');
    for (const pack of STYLE_PACKS) expect(plan.text).not.toContain(pack.fragment);
    expect(plan.text).not.toContain('undefined');
  });

  it('empty custom text carries the contract alone (no Style: line)', () => {
    const plan = compilePrompt({
      direction: CUSTOM_DIRECTION_ID,
      customText: '',
      scene: [],
      presentCategories: new Set(),
      images: { source: true },
    });

    expect(plan.text).not.toContain('Style:');
    expect(plan.text).toContain(BASE_CONTRACT);
    expect(plan.text).not.toContain('undefined');
  });

  it('source-only images emit no style/layout labels', () => {
    const plan = compilePrompt({
      direction: 'watercolor',
      scene: [],
      presentCategories: new Set(),
      images: { source: true },
    });

    expect(plan.text).toContain('The last image is the planning map to redraw.');
    expect(plan.text).not.toContain('style swatch');
    expect(plan.text).not.toContain('layout legend');
  });

  it('is deterministic and trims trailing whitespace', () => {
    const args = {
      direction: 'coastal' as const,
      scene: ['a river runs east to west across the map'],
      presentCategories: new Set(['road']),
      images: { source: true as const, style: 'pack' as const },
    };
    const a = compilePrompt(args);
    const b = compilePrompt(args);
    expect(a.text).toBe(b.text);
    expect(a.text).not.toMatch(/\s$/);
    expect(a.text.length).toBeGreaterThan(0);
  });

  it('a take-anchored compile names the reference as an earlier illustration of the same map', () => {
    const plan = compilePrompt({
      direction: 'watercolor',
      scene: [],
      presentCategories: new Set<string>(),
      images: { source: true as const, style: 'take' as const },
    });
    expect(plan.text).toContain('an earlier illustration of the SAME map');
    expect(plan.text).toContain('the last image wins');
    expect(plan.text).not.toContain('never copy any object');
  });
});
