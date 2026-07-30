import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { STAMP_PATH, resolveBuildInfo, resolveVersion, unstampedMessage } from './scripts/build-info-core.mts';
import { readFileSync } from 'node:fs';
import { bundleReportPlugin } from './security/bundle-report-plugin';
import {
  HEADERS_POLICY,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc,
} from './security/headers-policy';

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
const APP_VERSION = resolveVersion({
  pkgVersion: pkgVersion(), buildNumber: BUILD_INFO.buildNumber, release: BUILD_INFO.release,
});

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
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    define: {
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
