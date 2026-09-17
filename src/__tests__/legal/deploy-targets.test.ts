/**
 * Two deployments out of one repo. The facts that differ between them live in ONE table, because
 * the crawler-facing head and the in-app legal surfaces both read them and must not disagree about
 * which site they are.
 */
import { describe, it, expect } from 'vitest';
import { DEPLOY_TARGETS, targetById, type DeployTarget } from '../../legal/deploy-targets';

const ALL: DeployTarget[] = Object.values(DEPLOY_TARGETS);

describe('every target', () => {
  it('has a distinct https origin with no trailing slash or path', () => {
    // Two sites sharing a canonical URL would compete for the same search results.
    const origins = ALL.map((t) => t.canonicalOrigin);
    expect(new Set(origins).size).toBe(origins.length);
    for (const o of origins) {
      expect(o).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      expect(o.endsWith('/')).toBe(false);
    }
  });

  it('titles each deployment in ITS language, not both', () => {
    // Two sites means each has an audience. A bilingual tab title reads as a mistake to whichever
    // reader you actually have, and it is the first thing they see — before the app has loaded and
    // retitled for their locale.
    expect(DEPLOY_TARGETS.global.title).toContain('Petit Planet Map Editor & Planet Planner');
    expect(DEPLOY_TARGETS.global.description).toMatch(/^[\x20-\x7E]+$/);
    expect(DEPLOY_TARGETS.cn.title).toContain('2D/3D');
    expect(DEPLOY_TARGETS.cn.title).toBe('谷地工坊 - 星布谷地地图编辑器｜星球规划与 2D/3D 预览');
    // The one Latin run the zh description may carry is the game's own name: it is the term a
    // cross-language search arrives by, and a name is not a language switch.
    expect(DEPLOY_TARGETS.cn.description.replace(/Petit Planet/g, '')).not.toMatch(/[A-Za-z]{4}/);
  });

  it('still names both products, each in the deployment\'s own language', () => {
    // One page switches language in place, so there is no second URL for either name to be found
    // at — both have to be on this one.
    for (const t of ALL) {
      const zh = t.htmlLang.startsWith('zh');
      expect(t.title).toContain(zh ? '谷地工坊' : 'PetitMaker');   // the app
      expect(t.title).toContain(zh ? '星布谷地' : 'Petit Planet'); // the game it edits maps for
    }
  });

  it('carries a description long enough to be a search snippet', () => {
    for (const t of ALL) {
      expect(t.description.length).toBeGreaterThan(60);
    }
  });

  it('declares a document language a crawler can act on', () => {
    for (const t of ALL) expect(t.htmlLang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
  });
});

describe('filing rows', () => {
  it('are absent on the global build, which has no filing to claim', () => {
    const g = DEPLOY_TARGETS.global;
    expect(g.icpNumber).toBeNull();
    expect(g.psbNumber).toBeNull();
    expect(g.icpUrl).toBeNull();
  });

  it('point at the official registry on the mainland build', () => {
    expect(DEPLOY_TARGETS.cn.icpUrl).toBe('https://beian.miit.gov.cn/');
  });
});

describe('search verification metas', () => {
  it('the mainland build carries the Baidu ownership proof; the global build claims none', () => {
    expect(DEPLOY_TARGETS.cn.verificationMetas).toContainEqual({ name: 'baidu-site-verification', content: 'codeva-jY3ZDA0Q7F' });
    expect(DEPLOY_TARGETS.global.verificationMetas).toEqual([]);
  });
});

describe('targetById', () => {
  it('resolves the two ids', () => {
    expect(targetById('cn').id).toBe('cn');
    expect(targetById('global').id).toBe('global');
  });

  it('falls back to the GLOBAL build for anything unrecognized', () => {
    // The fallback must be the one that claims no filing: a typo in an env var must never make a
    // build assert a registration it does not have.
    for (const bad of [undefined, null, '', 'CN', 'zh', 'nonsense']) {
      expect(targetById(bad).id).toBe('global');
      expect(targetById(bad).icpNumber).toBeNull();
    }
  });
});
