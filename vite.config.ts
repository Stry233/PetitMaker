import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { transformHomepage } from './scripts/site-html.mts';
import { execSync } from 'node:child_process';
import { STAMP_PATH, resolveBuildInfo, resolveVersion, unstampedMessage } from './scripts/build-info-core.mts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleReportPlugin } from './security/bundle-report-plugin';
import {
  HEADERS_POLICY,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc, withExtraFontSrc,
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
function devCspExtensionPlugin(rawConnect: string | undefined, rawFont: string | undefined) {
  const connect = parseExtraConnectSrc(rawConnect);
  const fonts = parseExtraConnectSrc(rawFont);
  return {
      name: 'petit-dev-csp-extension',
      apply: 'serve' as const,
      transformIndexHtml(html: string) {
        if (connect.length === 0 && fonts.length === 0) return html;
        const metaContent = toCspMeta(withExtraFontSrc(withExtraConnectSrc(HEADERS_POLICY, connect), fonts));
        return html.replace(
          /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
          `$1${metaContent}$2`
        );
      },
    };
  }

/** Deployment-specific initial HTML is also used by the development server. */
function indexHeadPlugin(target: ReturnType<typeof activeTarget>, basePath: string) {
  return {
    name: 'petit-index-head',
    transformIndexHtml: {
      order: 'pre' as const,
      handler: (html: string) => transformHomepage(html, target, basePath),
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

/** onnxruntime-web's module names every runtime variant by URL, so Vite emits all of their binaries.
 *  Two are loaded (the single-threaded WASM build and the asyncify build the WebGPU backend runs
 *  on); the legacy jsep and the jspi variants never are, and the 27 MB jsep one alone would push
 *  the deploy over the static hosts' 25 MiB per-file limit. */
function dropUnusedOrtBinariesPlugin(): Plugin {
  return {
    name: 'drop-unused-ort-binaries',
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm-simd-threaded\.(jsep|jspi)[^/]*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const petitEnv = loadEnv(mode, process.cwd(), 'PETIT_');
  const exportSiteMark = (process.env.PETIT_EXPORT_SITE_MARK ?? petitEnv.PETIT_EXPORT_SITE_MARK) === '1';
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
      devCspExtensionPlugin(
        viteEnv.VITE_EXTRA_CONNECT_SRC ?? process.env.VITE_EXTRA_CONNECT_SRC,
        viteEnv.VITE_EXTRA_FONT_SRC ?? process.env.VITE_EXTRA_FONT_SRC,
      ),
      indexHeadPlugin(TARGET, process.env.PETIT_BASE_PATH || '/'),
      stampWatchPlugin(),
      dropUnusedOrtBinariesPlugin(),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    optimizeDeps: {
      // Worker-only imports escape the initial scan; discovering them during inference reloads the page.
      include: ['onnxruntime-web/webgpu', 'onnxruntime-web', 'opencc-js/t2cn', 'obscenity', '@2toad/profanity', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', 'nsfwjs/core', 'tesseract.js', 'wasm-feature-detect', 'cuss', 'linkify-it', 're2js'],
    },
    server: {
      /**
       * Ignore nested worktrees and scratch metadata. Their config-file writes would otherwise
       * trigger full dev-server reloads and interrupt live assistant sessions. Vite adds its own
       * defaults for dependency, cache and version-control directories.
       */
      watch: { ignored: ['**/.claude/**', '**/.superpowers/**'] },
    },
    define: {
      __PETIT_TARGET__: JSON.stringify(TARGET.id),
      // Deployments opt into the export footer's public URL and QR code explicitly. Keeping this
      // build-time prevents an exported image's attribution target from becoming a user setting.
      __PETIT_EXPORT_SITE_MARK__: JSON.stringify(exportSiteMark),
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __BUILD_NUMBER__: JSON.stringify(BUILD_INFO.buildNumber),
      __BUILD_SHA__: JSON.stringify(BUILD_INFO.sha),
      __BUILD_DATE__: JSON.stringify(BUILD_INFO.date),
    },
    // Strip console/debugger from the PRODUCTION bundle only (kept in dev for debugging) — less code
    // shipped, no stray logging that could leak internals.
    esbuild: { drop: mode === 'production' ? ['console', 'debugger'] : [] },
    // Module workers: the stylize inference worker code-splits (it loads one of two ONNX runtime
    // builds), which Rollup cannot do inside an IIFE.
    worker: { format: 'es' },
    build: {
      sourcemap: false, // never ship source maps (would hand attackers the readable source); also Vite's default — locked explicitly
      // No inline module-preload polyfill → no inline <script>, so the CSP can keep a strict
      // `script-src 'self'` (no 'unsafe-inline'). Modern browsers support modulepreload natively.
      modulePreload: { polyfill: false },
      // (minify stays on Vite's prod default, esbuild)
    },
  };
});
