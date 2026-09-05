/**
 * The skill library contract. A skill is picked from name+description alone
 * (progressive disclosure: only those sit in the tool surface), so descriptions
 * must be one short line; and a body is followed verbatim by the model, so a
 * tool or catalog id it names must exist — a playbook that misnames a tool is
 * worse than no playbook.
 */
import { describe, expect, it } from 'vitest';
import { SKILLS, listSkills } from '../../agent/skills';
import { TOOL_SCHEMAS } from '../../agent/tools';
import { THEMES } from '../../agent/tools/tools-director';
import { getCatalogItem } from '../../state/catalog';

const TOOL_NAMES = new Set(TOOL_SCHEMAS.map((t) => t.name));
/** Non-tool snake_case wire names a body may legitimately use. */
const WIRE_NAMES = new Set(['map_context']);

describe('skill metadata shape', () => {
  it('every skill has kind, title, description and body', () => {
    for (const [name, s] of Object.entries(SKILLS)) {
      expect(['method', 'style'], `${name} kind`).toContain(s.kind);
      expect(s.title.trim().length, `${name} title`).toBeGreaterThan(0);
      expect(s.description.trim().length, `${name} description`).toBeGreaterThan(0);
      expect(s.body.trim().length, `${name} body`).toBeGreaterThan(200);
    }
  });

  it('skill names are load_skill-friendly kebab-case', () => {
    for (const name of Object.keys(SKILLS)) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('descriptions are one line and short enough to scan in the catalogue', () => {
    for (const [name, s] of Object.entries(SKILLS)) {
      expect(s.description, `${name} description has a newline`).not.toContain('\n');
      expect(s.description.length, `${name} description length`).toBeLessThanOrEqual(160);
    }
  });

  it('bodies stay small enough to load mid-job', () => {
    for (const [name, s] of Object.entries(SKILLS)) {
      expect(s.body.length, `${name} body length`).toBeLessThanOrEqual(5000);
    }
  });

  it('listSkills names every skill under its kind header', () => {
    const out = listSkills();
    expect(out).toContain('METHOD skills');
    expect(out).toContain('STYLE set pieces');
    for (const [name, s] of Object.entries(SKILLS)) {
      expect(out, name).toContain(`- ${name}: ${s.description}`);
    }
  });
});

describe('skill bodies name only real things', () => {
  it('every snake_case token in a body or description is a registered tool name', () => {
    for (const [name, s] of Object.entries(SKILLS)) {
      const tokens = `${s.description}\n${s.body}`.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
      for (const tok of tokens) {
        expect(TOOL_NAMES.has(tok) || WIRE_NAMES.has(tok), `${name} names "${tok}"`).toBe(true);
      }
    }
  });

  it('every catalog-shaped id in a body resolves in the catalog', () => {
    const idRe = /\b(?:tree|flower|plant|shrub|path|bridge|ramp|building|facility)-[a-z][a-z0-9-]*\b/g;
    for (const [name, s] of Object.entries(SKILLS)) {
      for (const id of s.body.match(idRe) ?? []) {
        expect(getCatalogItem(id), `${name} names catalog id "${id}"`).toBeTruthy();
      }
    }
  });

  it('no body names set dressing the catalog cannot build', () => {
    // These nouns have no catalog item or supported construction, so skill prose must not promise
    // that the Agent can place them.
    const ghost = /\b(jetty|jetties|pier|piers|fountain|lantern|fence|statue|gazebo|dock)\b/i;
    for (const [name, s] of Object.entries(SKILLS)) {
      const hit = `${s.description}\n${s.body}`.match(ghost);
      expect(hit, `${name} names "${hit?.[0]}"`).toBeNull();
    }
  });

  it('every decorate_zone theme a body suggests is a real theme', () => {
    const themeRe = /decorate_zone ([a-z]+)\b/g;
    for (const [name, s] of Object.entries(SKILLS)) {
      for (const m of s.body.matchAll(themeRe)) {
        expect(THEMES as readonly string[], `${name} decorate_zone theme "${m[1]}"`).toContain(m[1]);
      }
    }
  });
});
