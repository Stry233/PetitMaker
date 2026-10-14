import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import sharp from 'sharp';
import { LITE_CSP } from '../security/lite-policy.ts';

/** Images at or below this size share the script; each separate file counts against the ZIP's 200-entry upload limit. */
const INLINE_IMAGE_BYTES = 8 * 1024;
const webpCache = new Map<string, Promise<Buffer>>();

/** Lite ships PNG artwork as WebP, capped at 1024 px on the long side. */
function liteWebp(source: Buffer): Promise<Buffer> {
  const key = createHash('sha256').update(source).digest('hex');
  let webp = webpCache.get(key);
  if (!webp) {
    webp = sharp(source).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 100 }).toBuffer();
    webpCache.set(key, webp);
  }
  return webp;
}

/** Decides inlining on the converted WebP bytes; PNG sources are often several times their WebP size. */
function liteInlineWebpPlugin(): Plugin {
  return {
    name: 'petit-lite-inline-webp',
    apply: 'build',
    enforce: 'pre',
    async load(id) {
      const file = /^([^?\0]+\.png)(?:\?url)?$/i.exec(id)?.[1];
      if (!file) return null;
      const webp = await liteWebp(readFileSync(file));
      if (webp.length > INLINE_IMAGE_BYTES) return null;
      return `export default ${JSON.stringify(`data:image/webp;base64,${webp.toString('base64')}`)};`;
    },
  };
}

export function liteBuildPlugin(): Plugin[] {
  return [liteInlineWebpPlugin(), liteShellPlugin()];
}

function liteShellPlugin(): Plugin {
  let development = false;
  let preview = false;
  const assets = new Map<string, Buffer>();
  return {
    name: 'petit-lite',
    config(_config, env) {
      // ResolvedConfig does not carry isPreview; the config hook's environment does.
      preview = env.isPreview === true;
      return { build: { assetsInlineLimit(filePath: string, content: Buffer) {
        // Fonts remain local files.
        return /\.(?:png|jpe?g|gif|webp|svg)$/i.test(filePath) && content.length <= INLINE_IMAGE_BYTES;
      } } };
    },
    configResolved(config) {
      development = config.command === 'serve' && !preview;
      for (const file of ['logo-256.png', 'banner.svg', 'banner-zh.svg']) assets.set(file, readFileSync(join(config.root, 'public', file)));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url?.split('?')[0]?.slice(1) ?? '';
        const asset = assets.get(file);
        if (!asset) return next();
        res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
        res.end(asset);
      });
    },
    async generateBundle(_options, bundle) {
      const replacements = new Map<string, string>();
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type !== 'asset' || !name.endsWith('.png')) continue;
        const source = typeof item.source === 'string' ? Buffer.from(item.source) : item.source;
        const webp = await liteWebp(Buffer.from(source));
        const next = name.replace(/\.png$/, '.webp');
        delete bundle[name];
        this.emitFile({ type: 'asset', fileName: next, source: webp });
        replacements.set(name, next);
      }
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const [before, after] of replacements) item.code = item.code.split(before.slice(before.lastIndexOf('/') + 1)).join(after.slice(after.lastIndexOf('/') + 1));
      }
      this.emitFile({ type: 'asset', fileName: 'compat.js', source: readFileSync('src/lite/compat.js') });
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const id of Object.keys(item.modules)) {
          if (/\/node_modules\/(?:onnxruntime|@tensorflow|tesseract|nsfwjs)|\/src\/agent\/(?:providers|session)\/|\/src\/.*\.worker\.[cm]?[jt]s/.test(id)) {
            this.error(`Unsupported module in Lite: ${id}`);
          }
        }
      }
    },
    // Vite discovers the entry as a module; the emitted bundle is a single classic IIFE.
    writeBundle(options) {
      const path = join(options.dir!, 'index.html');
      writeFileSync(path, readFileSync(path, 'utf8').replace('<body>', '<body><script src="./compat.js"></script>').replace(/ type="module"/g, ' defer').replace(/ crossorigin/g, '').replace(/<link rel="modulepreload"[^>]*>/g, ''));
    },
    transformIndexHtml: {
      order: 'pre',
      handler: () => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${development ? `<meta http-equiv="Content-Security-Policy" content="${LITE_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'none'", "connect-src 'self' ws: wss:")}">` : ''}<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%278%27 fill=%27%2374914a%27/%3E%3Cpath d=%27M8 24V8h9a6 6 0 0 1 0 12h-4v4zM13 12v4h4a2 2 0 0 0 0-4z%27 fill=%27%23fdfbe0%27/%3E%3C/svg%3E"><title>PetitMaker (Lite)</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#dfe7b5}button:disabled{opacity:.5;cursor:default}#root{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%}[data-lite-focus-fallback][data-focus-source="keyboard"] :focus{outline:3px solid var(--focus-ring,#fb923c)!important;outline-offset:2px!important;box-shadow:0 0 0 7px var(--focus-halo,transparent)}[data-lite-focus-fallback][data-focus-source="pointer"] :focus,[data-lite-focus-fallback][data-focus-source="program"] :focus{outline:none!important}</style></head><body><div id="root"></div><script type="module" src="/src/lite/main.tsx"></script></body></html>`,
    },
  };
}
