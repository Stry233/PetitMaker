import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { webManifest } from '../../../scripts/site-html.mts';

describe('web app manifest', () => {
  it('describes each deployment as an installable landscape app under its own name', () => {
    const global = JSON.parse(webManifest(DEPLOY_TARGETS.global));
    expect(global.name).toBe('PetitMaker');
    expect(global.lang).toBe('en');
    expect(global.display).toBe('standalone');
    expect(global.orientation).toBe('landscape');
    expect(global.start_url).toBe('./');
    expect(global.scope).toBe('./');
    expect(global.icons.map((i: { sizes: string }) => i.sizes)).toContain('256x256');
    const cn = JSON.parse(webManifest(DEPLOY_TARGETS.cn));
    expect(cn.name).toBe('谷地工坊');
    expect(cn.lang).toBe('zh-CN');
  });

  it('ships the global manifest as the static file the page links', () => {
    expect(readFileSync('public/manifest.webmanifest', 'utf8')).toBe(webManifest(DEPLOY_TARGETS.global));
    expect(readFileSync('index.html', 'utf8')).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });
});
