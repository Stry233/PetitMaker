import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { STAMP_PATH, resolveBuildInfo, resolveVersion, unstampedMessage } from './scripts/build-info-core.mts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleReportPlugin } from './security/bundle-report-plugin';
import {
  HEADERS_POLICY,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc,
} from './security/headers-policy';
import { activeTarget } from './src/legal/deploy-targets';

/**
 * DEV-ONLY: append `VITE_EXTRA_CONNECT_SRC` origins to the served index.html CSP
 * `<meta>` connect-src, so a maintainer can reach a personal Custom agent
 * endpoint (e.g. a campus gateway) in local development WITHOUT adding its
 * identifying origin to the canonical, public `security/headers-policy.ts`. This
 * plugin only registers for `apply: 'serve'` (the dev server) and is inert in any
 * build, so the extra origins never reach a committed adapter output or a
 * production bundle. See docs/THREAT_MODEL.md "Custom (BYO-endpoint) provider".
 */
function devCspExtensionPlugin(raw: string | undefined) {
  const extras = parseExtraConnectSrc(raw);
  return {
      name: 'petit-dev-csp-extension',
      apply: 'serve' as const,
      transformIndexHtml(html: string) {
        if (extras.length === 0) return html;
        const metaContent = toCspMeta(withExtraConnectSrc(HEADERS_POLICY, extras));
        return html.replace(
          /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
          `$1${metaContent}$2`
        );
      },
    };
  }

/**
 * The crawler-facing head of index.html. The app's entry page is an empty React container, so
 * the tags a search engine and a link preview read have to be injected at build time; the
 * prerendered legal pages get theirs from build-legal-pages.mts instead.
 *
 * A build served from a PATH rather than a domain root carries `noindex` in place of them. That
 * is the dev site (yuetian.me/Apollonius/) and any future preview: a second host serving the same
 * app competes with production for the same results, and shows unreleased work. robots.txt cannot
 * express it — a crawler only reads robots.txt at the domain root, which for a path deployment
 * belongs to a different site. Keyed on the base path rather than the release marker because
 * `npm run build:release` is run locally to check a release, and a local tree is never stamped
 * as published — that would make every local release build noindex itself.
 */
function indexHeadPlugin(target: ReturnType<typeof activeTarget>, basePath: string) {
  const origin = target.canonicalOrigin.replace(/\/$/, '');
  return {
    name: 'petit-index-head',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      // The title, the description, the document language and the boot loader's masthead belong
      // to the DEPLOYMENT (see src/legal/deploy-targets): the two sites want different ones, and a
      // crawler reads them out of the static file, so they are written in here rather than chosen
      // at runtime. The masthead swap covers the pre-React loading screen; the splash reads the
      // same target row at runtime.
      html = html
        .replace(/<html lang="[^"]*"/, `<html lang="${target.htmlLang}"`)
        .replace(/<title>[^<]*<\/title>/, `<title>${target.title}</title>`)
        .replace('src="/banner.svg"', `src="/${target.bootBanner}"`);
      const title = target.title;
      const tags = basePath === '/'
        ? [
            `<meta name="description" content="${target.description}" />`,
            `<meta name="keywords" content="${target.keywords}" />`,
            `<link rel="canonical" href="${origin}/" />`,
            `<meta property="og:type" content="website" />`,
            `<meta property="og:url" content="${origin}/" />`,
            `<meta property="og:title" content="${title}" />`,
            `<meta property="og:description" content="${target.description}" />`,
            `<meta property="og:image" content="${origin}/logo-256.png" />`,
            `<meta property="og:locale" content="${target.htmlLang === 'zh-CN' ? 'zh_CN' : 'en_US'}" />`,
            `<meta property="og:locale:alternate" content="${target.htmlLang === 'zh-CN' ? 'en_US' : 'zh_CN'}" />`,
            `<meta name="twitter:card" content="summary" />`,
          ]
        : ['<meta name="robots" content="noindex, nofollow" />'];
      return html.replace('</head>', `  ${tags.join('\n    ')}\n  </head>`);
    },
  };
}

  // Build metadata injected at build time. The identity is read from the COMMITTED
  // `build-info.json` and from nowhere else — not from local git, not from a deploy
  // host's environment — so every build of a given source tree reports the same
  // number whatever its clone depth, host, or lack of git. `npm run stamp` is the only
  // writer; see scripts/build-info-core.mts.
  function readStamp(): string | null {
    try {
      return readFileSync(STAMP_PATH, 'utf-8');
    } catch {
      return null;
    }
  }

  function pkgVersion(): string {
    try {
      return JSON.parse(readFileSync('./package.json', 'utf-8')).version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  const { info: BUILD_INFO, stamped: BUILD_IS_STAMPED } = resolveBuildInfo({ readStamp });
// MAJOR.MINOR.BUILD, with -dev unless the stamp says this tree was published. package.json
// supplies only the MAJOR.MINOR series; the publish workflow assigns the released version.
/** Which deployment this build is for (PETIT_TARGET). Read once: vite.config and the bundle must
 *  agree, so the id is also `define`d below rather than re-read inside the app. */
const TARGET = activeTarget();

const APP_VERSION = resolveVersion({
  pkgVersion: pkgVersion(), buildNumber: BUILD_INFO.buildNumber, release: BUILD_INFO.release,
  lastRelease: BUILD_INFO.lastRelease,
});

  /**
 * DEV-ONLY: restart the server when the build stamp changes.
 *
 * The build identity is `define`d once when the config loads, so a commit — which re-stamps
 * `build-info.json` through the pre-commit hook — leaves a running dev server serving the number it
 * started with. Restarting is what makes the version in the page answer the question it exists to
 * answer: whether what is loaded is what was just built.
 */
function stampWatchPlugin() {
  const stamp = resolve(process.cwd(), STAMP_PATH);
  return {
    name: 'petit-stamp-watch',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      server.watcher.add(stamp);
      server.watcher.on('change', (file: string) => {
        if (resolve(file) === stamp) void server.restart();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    // An unstamped PRODUCTION build would ship a build number that identifies nothing,
    // so it fails here instead. Dev/test only warns.
    if (!BUILD_IS_STAMPED) {
      if (mode === 'production') throw new Error(unstampedMessage(true));
      console.warn(unstampedMessage(false));
    }
    return {
    // Where the app will be served from. Production is a domain root; the dev site is a
    // PROJECT Pages site under a path (yuetian.me/Apollonius/), and every bundled asset,
    // chunk and font URL has to carry that prefix or the page loads a blank screen. Set by
    // the deploy workflow; unset everywhere else, so a normal build is unchanged.
    base: process.env.PETIT_BASE_PATH || '/',
    // loadEnv makes a git-ignored `.env.local` work for the dev-only CSP
    // extension (process.env alone only sees shell-exported vars).
    plugins: [
      react(),
      bundleReportPlugin(),
      devCspExtensionPlugin(loadEnv(mode, process.cwd(), 'VITE_').VITE_EXTRA_CONNECT_SRC ?? process.env.VITE_EXTRA_CONNECT_SRC),
      indexHeadPlugin(TARGET, process.env.PETIT_BASE_PATH || '/'),
      stampWatchPlugin(),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    server: {
      /**
       * DIRECTORIES INSIDE THE ROOT THAT ARE NOT THE APP.
       *
       * An agent working in a git worktree under `.claude/worktrees/` writes a whole second copy of
       * this tree inside the dev server's root, and one of the files in it is a `tsconfig.json`: the
       * watcher answers that with "changed tsconfig file detected, forcing full-reload", which
       * reloads whatever page is open. A live session in the assistant panel does not survive a
       * reload it did not ask for (a session belongs to a map, and an unsaved map has none to come
       * back to), so a run in a shared checkout lost a job to a sibling's commit. Scratch notes
       * under `.superpowers/` are the same class of write and never source the bundle reads.
       *
       * Vite merges these with its own defaults (`.git`, `node_modules`, the cache dir).
       */
      watch: { ignored: ['**/.claude/**', '**/.superpowers/**'] },
    },
    define: {
      __PETIT_TARGET__: JSON.stringify(TARGET.id),
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __BUILD_NUMBER__: JSON.stringify(BUILD_INFO.buildNumber),
      __BUILD_SHA__: JSON.stringify(BUILD_INFO.sha),
      __BUILD_DATE__: JSON.stringify(BUILD_INFO.date),
    },
    // Strip console/debugger from the PRODUCTION bundle only (kept in dev for debugging) — less code
    // shipped, no stray logging that could leak internals.
    esbuild: { drop: mode === 'production' ? ['console', 'debugger'] : [] },
    build: {
      sourcemap: false, // never ship source maps (would hand attackers the readable source); also Vite's default — locked explicitly
      // No inline module-preload polyfill → no inline <script>, so the CSP can keep a strict
      // `script-src 'self'` (no 'unsafe-inline'). Modern browsers support modulepreload natively.
      modulePreload: { polyfill: false },
      // (minify defaults to esbuild in prod; left as-is)
    },
  };
});
