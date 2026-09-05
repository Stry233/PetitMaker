/**
 * The agent panel is not a special module: it owns no palette of its own. Every colour it paints
 * resolves to `ui/design/styles.ts` or `ui/design/tokens.ts`, and every measurement it shares with
 * the frame is derived in ONE place. This suite is what makes that checkable rather than intended.
 *
 * The scan reads RAW TEXT, comments included: a hex spelled out in a provenance note is a second
 * place to read the value from, and the two drift the moment one is tuned. Name the token instead.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve } from 'node:path';
import { metaInk, PANEL_WIDTH, statePaper, tickInk } from '../../../ui/agent/tokens';
import { withAlpha } from '../../../ui/design/styles';
import { PANEL_COLUMN_W } from '../../../ui/shell/panel-frame';
import { colors, radii } from '../../../ui/design/styles';
import { INK } from '../../../ui/design/tokens';
import { windowFooterPrimary, windowPrimary } from '../../../ui/design/window-skin';
import { RESUME_PRIMARY } from '../../../ui/agent/atoms';

declare const __dirname: string;

/**
 * The character is a DRAWING, and its hexes are pigments in that drawing rather than interface
 * values: the badge outline tables, the pose art, the PSD-extracted plates. Nothing else in the
 * panel may hold one.
 */
const ART_FILES = ['character/poses.ts', 'character/Character.tsx', 'character/badges.tsx'];

const AGENT_DIR = resolve(__dirname, '../../../ui/agent');

/** Every `.ts`/`.tsx` under `ui/agent/`, keyed by its path relative to that directory. */
function panelSources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) {
        out.push({
          rel: full.replace(/\\/g, '/').slice(AGENT_DIR.length + 1),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(AGENT_DIR);
  return out;
}

describe('the panel holds no palette of its own', () => {
  it('names no six-digit hex outside the character art', () => {
    const offenders: string[] = [];
    for (const { rel, text } of panelSources()) {
      if (ART_FILES.includes(rel)) continue;
      const hits = text.match(/#[0-9A-Fa-f]{6}\b/g);
      if (hits) offenders.push(`${rel}: ${[...new Set(hits)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('finds the art files it exempts, so the whitelist cannot rot', () => {
    const present = new Set(panelSources().map((f) => f.rel));
    for (const rel of ART_FILES) expect(present.has(rel), rel).toBe(true);
  });
});

describe('every panel value resolves to the design layer', () => {
  it('the reasoning paper is the design layer s own', () => {
    expect(statePaper.think).toBe(colors.paperThink);
  });

  it('the abort tone is the design layer s own', () => {
    expect(statePaper.stop).toBe(colors.stopTaupe);
  });

  it('the revert ink is the design layer s own', () => {
    expect(tickInk.revert).toBe(colors.revertAmber);
  });

  it('a finished op is the quiet ink, not a green of its own', () => {
    expect(tickInk.ok).toBe(INK);
  });

  it('every state paper is a design-layer colour', () => {
    const palette = new Set(Object.values(colors).map(String));
    for (const [state, value] of Object.entries(statePaper)) {
      expect(palette.has(value), `${state} = ${value}`).toBe(true);
    }
  });

  it('every tick ink is a design-layer colour', () => {
    const palette = new Set<string>([...Object.values(colors).map(String), INK]);
    for (const [outcome, value] of Object.entries(tickInk)) {
      expect(palette.has(value), `${outcome} = ${value}`).toBe(true);
    }
  });
});

describe('the panel width is derived once', () => {
  it('is the mode row s own width, not a second copy of it', () => {
    expect(PANEL_WIDTH).toBe(PANEL_COLUMN_W);
  });
});

describe('withAlpha always emits a two-digit hex byte', () => {
  it('pins the danger meta ink unchanged, an 8-digit colour ending b8', () => {
    expect(metaInk.danger).toBe(`${colors.dangerDeep}b8`);
    expect(metaInk.danger).toHaveLength(9);
  });

  it('pads an alpha byte under 0x10 rather than emitting a 7-digit colour', () => {
    // 0.05 * 255 = 12.75, rounds to 13 = 0xd: a single hex digit unless padded.
    expect(withAlpha(colors.dangerDeep, 0.05)).toBe(`${colors.dangerDeep}0d`);
    expect(withAlpha(colors.dangerDeep, 0.05)).toHaveLength(9);
  });
});

/**
 * `edge` IS A WHOLE SHORTHAND, so nothing may write a width in front of it.
 *
 * `tokens.ts:edge` re-exports the shell's `PANEL_EDGE`, which is `1px solid <colour>`. A card that
 * spells `1px solid ${edge}` emits `1px solid 1px solid <colour>` — one invalid declaration, dropped
 * entire, and the card ships with no outline at all against a plate it is a shade away from. The
 * mistake is invisible by hand: the value reads correct at the call site and the failure is silent
 * at every layer below. `trouble.test.tsx` asserts the two cards' resolved borders; this is
 * the rule, so the next card cannot rediscover it.
 */
describe('the panel writes its one border treatment one way', () => {
  it('never puts a width in front of the edge shorthand', () => {
    const offenders: string[] = [];
    for (const { rel, text } of panelSources()) {
      // Any `<n>px solid` (or a ternary of colours) immediately followed by the shorthand token.
      if (/solid \$\{[^}]*\bedge\b[^}]*\}/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * ONE PRIMARY, ONE RADIUS, and it is a token.
 *
 * The house has two ink primaries because it has two SHAPES: `windowPrimary` is the centred confirm
 * and carries a radius authored for that shape; `windowFooterPrimary` is the one that stretches
 * across the foot of a column at the house radius. Every primary in this panel is the stretched one —
 * the gate cards' Approve, Resume wherever it stands, the setup foot, the manage Done — and one that
 * reaches for the centred token, overriding its `flex` and its `padding`, keeps a radius authored
 * for another shape: the panel then draws its cards at one corner and its screens at another.
 */
describe('the panel draws one primary', () => {
  it('gives the gate primary and the hold primary the footer radius, which is a token', () => {
    const radius = String(windowFooterPrimary.borderRadius);
    expect(radius).toBe(String(radii.md));
    expect(String(RESUME_PRIMARY.borderRadius)).toBe(radius);
    // And the centred confirm's own radius is NOT what the panel draws.
    expect(String(windowPrimary.borderRadius)).not.toBe(radius);
  });

  it('reaches every radius it draws out of the house table', () => {
    const family = new Set(Object.values(radii).map(Number));
    // The panel also uses a small local ladder for compact controls, hairlines, and stadium shapes.
    const panelLadder = new Set([1, 2, 5, 6, 8, 9, 10, 999]);
    const offenders: string[] = [];
    for (const { rel, text } of panelSources()) {
      for (const [, n] of text.matchAll(/borderRadius: (\d+)(?![.\d])/g)) {
        const value = Number(n);
        if (!family.has(value) && !panelLadder.has(value)) offenders.push(`${rel}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
