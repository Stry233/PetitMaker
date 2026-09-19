import { liteAliases, webEditionBoundary } from './scripts/edition-build.mts';
import { liteCompatibilityPlugin } from './scripts/lite-compat-build.mts';
import { liteBuildPlugin } from './scripts/lite-build-plugin.mts';
import { artworkBuildPlugin } from './scripts/artwork-build.mts';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { transformHomepage } from './scripts/site-html.mts';
import { STAMP_PATH, resolveBuildInfo, resolveVersion, unstampedMessage } from './scripts/build-info-core.mts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleReportPlugin } from './security/bundle-report-plugin.ts';
import {
  HEADERS_POLICY,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc, withExtraFontSrc,
} from './security/headers-policy.ts';
import { activeTarget } from './src/legal/deploy-targets.ts';

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

const { info: BUILD_INFO, stamped: BUILD_IS_STAMPED } = resolveBuildInfo({ readStamp });
// Resolve once so generated HTML and the app receive the same deployment target.
const TARGET = activeTarget();

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
      ...(!lite ? [artworkBuildPlugin(), bundleReportPlugin(), webEditionBoundary()] : []),
      ...(!lite ? [devCspExtensionPlugin(
        viteEnv.VITE_EXTRA_CONNECT_SRC ?? process.env.VITE_EXTRA_CONNECT_SRC,
        viteEnv.VITE_EXTRA_FONT_SRC ?? process.env.VITE_EXTRA_FONT_SRC,
      )] : []),
      lite ? liteBuildPlugin() : indexHeadPlugin(TARGET, process.env.PETIT_BASE_PATH || '/'),
      stampWatchPlugin(),
      dropUnusedOrtBinariesPlugin(),
    ],
    resolve: {
      alias: [
        ...(lite ? liteAliases : []),
        { find: '@', replacement: resolve('src') },
      ],
    },
    optimizeDeps: {
      // Worker-only imports escape the initial scan; discovering them during inference reloads the page.
      include: lite ? [] : ['onnxruntime-web/webgpu', 'onnxruntime-web', 'opencc-js/t2cn', 'obscenity', '@2toad/profanity', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', 'nsfwjs/core', 'tesseract.js', 'wasm-feature-detect', 'cuss', 'linkify-it', 're2js'],
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
      ...(lite ? { 'import.meta.url': 'document.baseURI' } : {}),
      __PETIT_LITE__: JSON.stringify(lite),
      __PETIT_TARGET__: JSON.stringify(TARGET.id),
      // Deployments opt into the export footer's public URL and QR code explicitly. Keeping this
      // build-time prevents an exported image's attribution target from becoming a user setting.
      __PETIT_EXPORT_SITE_MARK__: JSON.stringify(exportSiteMark),
      __APP_VERSION__: JSON.stringify(lite && command === 'build' ? APP_VERSION.replace(/-dev$/, '') : APP_VERSION),
      __BUILD_NUMBER__: JSON.stringify(BUILD_INFO.buildNumber),
      __BUILD_SHA__: JSON.stringify(BUILD_INFO.sha),
      __BUILD_DATE__: JSON.stringify(BUILD_INFO.date),
    },
    // Module workers: the stylize inference worker code-splits (it loads one of two ONNX runtime
    // builds), which Rollup cannot do inside an IIFE.
    worker: { format: 'es' },
    build: {
      outDir: lite ? 'dist-lite' : 'dist',
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
