import { DEPLOY_TARGETS } from '../src/legal/deploy-targets';
import { canonicalPagePath } from '../src/legal/site-paths';

interface AssetEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const GLOBAL = DEPLOY_TARGETS.global;
const HOSTS = [GLOBAL.canonicalOrigin, ...GLOBAL.legacyOrigins].flatMap((origin) => [
  new URL(origin).hostname,
  `www.${new URL(origin).hostname}`,
]);

export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    const url = new URL(request.url);
    const page = canonicalPagePath(url.pathname, GLOBAL.canonicalOrigin);
    if (HOSTS.includes(url.hostname)) {
      const canonical = new URL(GLOBAL.canonicalOrigin);
      canonical.pathname = page ?? url.pathname;
      canonical.search = url.search;
      if (canonical.href !== url.href) return Response.redirect(canonical.href, 308);
    }

    // Explicit files keep missing URLs as 404s and avoid a second HTML-normalization redirect.
    if (page !== null) url.pathname = page === '/' ? '/index.html' : `${page}/index.html`;
    const response = await env.ASSETS.fetch(new Request(url, request));
    if (!HOSTS.includes(url.hostname)) {
      const preview = new Response(response.body, response);
      preview.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return preview;
    }
    return response;
  },
};
