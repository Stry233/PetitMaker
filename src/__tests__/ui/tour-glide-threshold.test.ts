import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, type TourTargetId } from '../../ui/chrome/tour/steps';
import { litBox, movedFar, GLIDE_MAX_TRAVEL } from '../../ui/chrome/tour/TourOverlay';

/** A DOMRect-shaped object, the same lightweight stand-in tour-overlay.test.tsx builds: jsdom lays
 *  nothing out, so a fixture has to carry a real rect's shape by hand. */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, width, height, left, top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/**
 * Real `getBoundingClientRect()` for every tour target, captured once from the live app (headless
 * browser over CDP, driving real `setMenuCollapsed`/clicks the way `scripts/internal/
 * build-readme-figures.mts` drives the editor) at the two viewport sizes below. This exists to pin
 * ONE property — that consecutive step pairs sit unambiguously on one side of the glide/cut
 * threshold — not to track pixel-perfect layout; re-measure and update it if a target's chrome
 * moves enough to matter.
 */
const MEASURED: Partial<Record<TourTargetId, { small: DOMRect; large: DOMRect }>> = {
  'menu-collapsed': { small: rect(43, 16, 70, 93), large: rect(75, 23, 144, 191) },
  'menu-tiles': { small: rect(38, 275, 219, 222), large: rect(71, 515, 410, 417) },
  'menu-home': { small: rect(110, 509, 72, 17), large: rect(206, 954, 135, 32) },
  'layer-numbers': { small: rect(976, 39, 23, 18), large: rect(3351, 73, 44, 33) },
  'view-toggle': { small: rect(832, 39, 23, 18), large: rect(3081, 73, 44, 33) },
};

const VIEWPORTS = { small: [1024, 768], large: [3440, 1440] } as const;

/** How far a pair's ratio must sit from `GLIDE_MAX_TRAVEL` to count as unambiguous, as a fraction
 *  OF the threshold. The tour's tightest pair today (`open` -> `menu`) sits about 22% below it at
 *  1024x768; this is comfortably under that so today's steps pass, but tight enough to fail if a
 *  future step lands anywhere near the line. */
const MARGIN = 0.15;

describe("the tour's own step pairs, against the glide/cut threshold", () => {
  const targeted = TOUR_STEPS.filter((s): s is typeof s & { target: TourTargetId } => s.target != null);
  const pairs = targeted.slice(1).map((to, i) => [targeted[i]!, to] as const);

  it('has consecutive targeted pairs to check', () => {
    // A change to TOUR_STEPS that leaves fewer than two targeted steps would make every loop
    // below vacuously pass, which is the one way this file could stop meaning anything.
    expect(pairs.length).toBeGreaterThan(0);
  });

  for (const [from, to] of pairs) {
    for (const [label, [w, h]] of Object.entries(VIEWPORTS)) {
      it(`${from.id} -> ${to.id} is unambiguous at ${label} (${w}x${h})`, () => {
        const fromFixture = MEASURED[from.target];
        const toFixture = MEASURED[to.target];
        if (!fromFixture || !toFixture) {
          throw new Error(
            `no measured fixture for '${from.target}' or '${to.target}': re-measure the real chrome ` +
            '(see CLAUDE.md, "Screenshotting the React/DOM UI") and add it to MEASURED above.',
          );
        }
        const key = label as 'small' | 'large';
        const [ow, oh] = [window.innerWidth, window.innerHeight];
        Object.assign(window, { innerWidth: w, innerHeight: h });
        try {
          const a = litBox(fromFixture[key]);
          const b = litBox(toFixture[key]);
          const dx = (a.left + a.width / 2) - (b.left + b.width / 2);
          const dy = (a.top + a.height / 2) - (b.top + b.height / 2);
          const ratio = Math.hypot(dx, dy) / Math.hypot(w, h);
          // Sanity: this ratio agrees with the tour's own decision function, not a copy of it.
          expect(movedFar(a, b)).toBe(ratio > GLIDE_MAX_TRAVEL);
          expect(Math.abs(ratio - GLIDE_MAX_TRAVEL) / GLIDE_MAX_TRAVEL).toBeGreaterThan(MARGIN);
        } finally {
          Object.assign(window, { innerWidth: ow, innerHeight: oh });
        }
      });
    }
  }
});
