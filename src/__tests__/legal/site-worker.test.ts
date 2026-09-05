// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { LEGAL } from '../../legal/config';
import { pageHtml, pagePlan, sitemapXml } from '../../../scripts/legal-pages-core.mts';
import { transformHomepage } from '../../../scripts/site-html.mts';
import worker from '../../../security/site-worker';
const input = readFileSync('index.html', 'utf8');

describe('international edge routing', () => {
  const assetFetch = async (request: Request) => {
    const path = new URL(request.url).pathname;
    return new Response(path, {
      status: [
        '/index.html',
        '/about/index.html',
        '/zh/about/index.html',
        '/robots.txt',
        '/sitemap.xml',
        '/assets/map.png',
      ].includes(path)
        ? 200
        : 404,
    });
  };
  const env = { ASSETS: { fetch: assetFetch } };

  it('redirects scheme, host and HTML aliases in one permanent hop without losing queries', async () => {
    const hosts = ['petit-maker.com', 'www.petit-maker.com', 'petitmaker.cc', 'www.petitmaker.cc'];
    for (const host of hosts)
      for (const scheme of ['http', 'https']) {
        for (const [path, final] of [
          ['/', '/'],
          ['/about/', '/about'],
          ['/zh/about/index.html', '/zh/about'],
          ['/about.html', '/about'],
          ['/assets/map.png', '/assets/map.png'],
          ['/missing/nested/', '/missing/nested/'],
        ] as const) {
          const source = `${scheme}://${host}${path}?map=a%2Fb&x=1&x=2`;
          const destination = `https://petitmaker.cc${final}?map=a%2Fb&x=1&x=2`;
          const response = await worker.fetch(new Request(source), env);
          if (source === destination) {
            expect(response.status).toBe(path.startsWith('/missing') ? 404 : 200);
          } else {
            expect(response.status).toBe(308);
            expect(response.headers.get('location')).toBe(destination);
            const next = await worker.fetch(new Request(destination), env);
            expect(next.status).toBe(path.startsWith('/missing') ? 404 : 200);
            expect(next.headers.get('location')).toBeNull();
          }
        }
      }
  });

  it('keeps missing routes as 404 and never redirects the Chinese host to the international site', async () => {
    expect((await worker.fetch(new Request('https://petitmaker.cc/editor'), env)).status).toBe(404);
    expect(
      (await worker.fetch(new Request('https://petitmaker.com.cn/'), env)).headers.get('location'),
    ).toBeNull();
    expect(
      (await worker.fetch(new Request('https://preview.workers.dev/'), env)).headers.get('X-Robots-Tag'),
    ).toContain('noindex');
  });

  it('every international sitemap page resolves directly through the production router', async () => {
    const cfg = { ...LEGAL, canonicalOrigin: DEPLOY_TARGETS.global.canonicalOrigin };
    const pages = new Map(pagePlan(cfg).map((p) => [`${p.path}/index.html`, pageHtml(p.id, p.lang, cfg)]));
    pages.set('/index.html', transformHomepage(input, DEPLOY_TARGETS.global, '/'));
    const assets = {
      ASSETS: {
        fetch: async (req: Request) => {
          const html = pages.get(new URL(req.url).pathname);
          return new Response(html ?? '', { status: html ? 200 : 404 });
        },
      },
    };
    for (const match of sitemapXml(cfg).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const response = await worker.fetch(new Request(match[1]!), assets);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(`rel="canonical" href="${match[1]}"`);
      expect(html).not.toContain('name="robots"');
    }
  });
});
