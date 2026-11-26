import { LITE_HOST_ALIASES, liteAliases, webEditionBoundary } from './scripts/edition-build.mts';
import { liteBuildFolder } from './scripts/lite-package-core.mts';
import { liteCompatibilityPlugin } from './scripts/lite-compat-build.mts';
import { liteBuildPlugin } from './scripts/lite-build-plugin.mts';
import { artworkBuildPlugin } from './scripts/artwork-build.mts';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { transformHomepage } from './scripts/site-html.mts';
import { STAMP_PATH, resolveBuildInfo, resolveVersion, unstampedMessage } from './scripts/build-info-core.mts';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleReportPlugin } from './scripts/bundle-report-plugin.mts';
import { WORKER_FILES_TOKEN, assetSizeManifest, moderationDir, moderationFingerprint, workerFileCollector, workerFileInjector } from './scripts/warm-build.mts';
import {
  HEADERS_POLICY,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc, withExtraFontSrc,
} from './security/headers-policy.ts';
import { activeTarget } from './src/platform/build/deploy-targets.ts';
import { SIGN_IN_PATH, handleSignIn } from './edge/sign-in.js';
import { activeLiteHost } from './src/platform/build/lite-hosts.ts';

// Local endpoints extend only the development CSP; production uses the canonical policy.
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
        `$1${metaContent}$2`,
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

// The committed stamp is the build identity on every host, including shallow and Git-free checkouts.
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

/** The repository root, with forward slashes, for the root-anchored serving rules below. */
/** Top-level paths whose changes reload the dev server. */
const WATCHED = ['src', 'public', 'index.html', 'app.html', 'scripts', 'security'];
const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

/**
 * The pages the dependency scan starts from: the app and the development harness pages. Vite's
 * default scans every HTML file under the root, which reaches a nested worktree's own index.html
 * and node_modules and pre-bundles a second React.
 */
export const DEP_SCAN_ENTRIES = ['index.html', 'scripts/internal/**/*.html'];

/**
 * Vite's default deny list, plus nested worktrees and any dependency tree under tool output.
 * Anchored at the root so a checkout that is itself a nested worktree still serves its own files;
 * harness Vite caches under tool output stay servable.
 */
export const SERVE_DENY = ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', `${ROOT}/.claude/**`, `${ROOT}/artifacts/**/node_modules/**`];

const { info: BUILD_INFO, stamped: BUILD_IS_STAMPED } = resolveBuildInfo({ readStamp });
// Resolve once so generated HTML and the app receive the same deployment target.
const TARGET = activeTarget();
// The same for the container a Lite build is packaged for; an unknown PETIT_LITE_HOST fails here.
const LITE_HOST = activeLiteHost();

const APP_VERSION = resolveVersion({
  pkgVersion: pkgVersion(), buildNumber: BUILD_INFO.buildNumber, release: BUILD_INFO.release,
  lastRelease: BUILD_INFO.lastRelease,
});

// Vite caches define values until a restart, including the stamp updated by a commit.
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

/**
 * Runs the mainland sign-in exchange (`edge/sign-in.js`) on the dev server, with a test application's
 * credentials read from the git-ignored `.env.local`. A developer signs in against that application
 * here, so no test credential or test traffic reaches a deployed function.
 */
function signInDevEndpoint(local: Record<string, string>): Plugin {
  return {
    name: 'petit-sign-in-dev',
    apply: 'serve',
    configureServer(server: import('vite').ViteDevServer) {
      // The dev server answers a folder address with the app; a static host answers it with the
      // folder's own page, which is what the sign-in return address relies on.
      server.middlewares.use((req, res, next) => {
        if (req.url && /^\/connect\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/connect\/?/, '/connect/index.html');
        // The deployed sites send this header, and it is what cuts a sign-in window's handle.
        res.setHeader('Cross-Origin-Opener-Policy', HEADERS_POLICY.staticHeaders['Cross-Origin-Opener-Policy'] ?? 'same-origin');
        next();
      });
      server.middlewares.use(SIGN_IN_PATH, (req, res) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const origin = `http://${req.headers.host ?? 'localhost'}`;
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
          const request = new Request(origin + SIGN_IN_PATH, {
            method: req.method ?? 'GET', headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          });
          const response = await handleSignIn(request, {
            SIGN_IN_ALLOWED_ORIGINS: origin,
            MODELSCOPE_REDIRECT_URI: `${origin}/connect/`,
            ...local,
          }, fetch);
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(await response.text());
        })();
      });
    },
  };
}

// ONNX emits every runtime variant; unused jsep/jspi binaries exceed static-host file limits.
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

export default defineConfig(({ mode, command }) => {
  const lite = mode === 'lite';
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const petitEnv = loadEnv(mode, process.cwd(), 'PETIT_');
  const exportSiteMark = (process.env.PETIT_EXPORT_SITE_MARK ?? petitEnv.PETIT_EXPORT_SITE_MARK) === '1';
  // The web build fingerprints the map check's folder and lists each worker's files for the warm schedule.
  const webBuild = !lite && command === 'build';
  const moderationFolder = webBuild ? moderationDir() : 'moderation/';
  // Production must identify a source build; local development can run before its first stamp.
  if (!BUILD_IS_STAMPED) {
    if (command === 'build') throw new Error(unstampedMessage(true));
    console.warn(unstampedMessage(false));
  }
  return {
    // Path-based previews need the deployment prefix on every emitted resource.
    base: lite ? './' : process.env.PETIT_BASE_PATH || '/',
    publicDir: lite ? false : 'public',
    ...(lite ? {
      experimental: {
        renderBuiltUrl(filename: string, context: { hostType: string }) {
          return context.hostType === 'js'
            ? { runtime: `new URL(${JSON.stringify('./' + filename)}, document.baseURI).href` }
            : { relative: true };
        },
      },
    } : {}),
    plugins: [
      ...(lite ? [liteCompatibilityPlugin()] : []),
      react(),
      ...(!lite ? [signInDevEndpoint(loadEnv(mode, process.cwd(), ['MODELSCOPE_', 'SIGN_IN_']))] : []),
      ...(!lite ? [artworkBuildPlugin(), bundleReportPlugin(), webEditionBoundary()] : []),
      ...(webBuild ? [workerFileInjector(), moderationFingerprint(moderationFolder)] : []),
      ...(!lite ? [assetSizeManifest()] : []),
      ...(!lite ? [devCspExtensionPlugin(
        viteEnv.VITE_EXTRA_CONNECT_SRC ?? process.env.VITE_EXTRA_CONNECT_SRC,
        viteEnv.VITE_EXTRA_FONT_SRC ?? process.env.VITE_EXTRA_FONT_SRC,
      )] : []),
      lite ? liteBuildPlugin(LITE_HOST) : indexHeadPlugin(TARGET, process.env.PETIT_BASE_PATH || '/'),
      stampWatchPlugin(),
      dropUnusedOrtBinariesPlugin(),
    ],
    resolve: {
      alias: lite ? [...LITE_HOST_ALIASES[LITE_HOST.id], ...liteAliases] : [],
    },
    optimizeDeps: {
      entries: DEP_SCAN_ENTRIES,
      // Worker-only imports escape the initial scan; discovering them during inference reloads the page.
      include: lite ? [] : ['onnxruntime-web/webgpu', 'onnxruntime-web', 'opencc-js/t2cn', 'obscenity', '@2toad/profanity', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', 'nsfwjs/core', 'tesseract.js', 'wasm-feature-detect', 'cuss', 'linkify-it', 're2js'],
    },
    server: {
      /**
       * Ignore nested worktrees, scratch metadata and tool output. Their writes would otherwise
       * trigger full dev-server reloads and interrupt live assistant sessions. Vite adds its own
       * defaults for dependency, cache and version-control directories. The patterns match absolute
       * paths, so they are anchored at the root: a checkout that is itself a nested worktree still
       * watches its own files.
       */
      // Reloads only follow the app's own sources; every other top-level tree (worktrees, scratch,
      // tooling environments, reference media) is unwatched, since a few servers watching the whole
      // tree exhausted the inotify limit. Unwatched files still serve and import.
      watch: { ignored: (path: string) => { const rel = relative(ROOT, path); return rel !== '' && !rel.startsWith('..') && !WATCHED.some((top) => rel === top || rel.startsWith(`${top}/`)); } },
      fs: { deny: SERVE_DENY },
    },
    define: {
      ...(lite ? { 'import.meta.url': 'document.baseURI' } : {}),
      __PETIT_LITE__: JSON.stringify(lite),
      __PETIT_TARGET__: JSON.stringify(TARGET.id),
      __PETIT_LITE_HOST__: JSON.stringify(LITE_HOST.id),
      // Deployments opt into the export footer's public URL and QR code explicitly. Keeping this
      // build-time prevents an exported image's attribution target from becoming a user setting.
      __PETIT_EXPORT_SITE_MARK__: JSON.stringify(exportSiteMark),
      __APP_VERSION__: JSON.stringify(lite && command === 'build' ? APP_VERSION.replace(/-dev$/, '') : APP_VERSION),
      __BUILD_NUMBER__: JSON.stringify(BUILD_INFO.buildNumber),
      __BUILD_SHA__: JSON.stringify(BUILD_INFO.sha),
      __BUILD_DATE__: JSON.stringify(BUILD_INFO.date),
      __PETIT_MODERATION_DIR__: JSON.stringify(moderationFolder),
      __PETIT_WORKER_FILES__: JSON.stringify(webBuild ? WORKER_FILES_TOKEN : ''),
    },
    // Module workers: the stylize inference worker code-splits (it loads one of two ONNX runtime
    // builds), which Rollup cannot do inside an IIFE.
    worker: { format: 'es', plugins: () => (webBuild ? [workerFileCollector()] : []) },
    build: {
      outDir: lite ? liteBuildFolder(LITE_HOST.id) : 'dist',
      ...(lite ? { target: ['es2017', 'chrome61'], cssTarget: 'chrome61', cssCodeSplit: false } : {}),
      sourcemap: false,
      // No inline module-preload polyfill → no inline <script>, so the CSP can keep a strict
      // `script-src 'self'` (no 'unsafe-inline'). Modern browsers support modulepreload natively.
      modulePreload: lite ? false : { polyfill: false },
      // Console and debugger statements leave the production bundle here; the Oxc transform has no drop option.
      rolldownOptions: {
        output: {
          ...(lite ? { format: 'iife' as const, inlineDynamicImports: true } : {}),
          minify: mode !== 'development' ? { compress: { dropConsole: true, dropDebugger: true } } : undefined,
        },
      },
    },
  };
});
