import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';
import type { Plugin, ResolvedConfig } from 'vite';

/** Keep dimensions, color profiles and every RGBA value, including invisible RGB. */
export async function losslessArtwork(source: Uint8Array): Promise<Uint8Array | null> {
  const metadata = await sharp(source).metadata();
  // WebP stores eight bits per channel; higher-depth artwork must keep its PNG.
  if (metadata.depth !== 'uchar' || (metadata.pages ?? 1) !== 1) return null;
  const webp = await sharp(source).keepIccProfile().webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
  if (webp.length >= source.length) return null;
  const original = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (original.info.width !== decoded.info.width || original.info.height !== decoded.info.height || !original.data.equals(decoded.data)) {
    throw new Error('Lossless artwork changed decoded pixels');
  }
  return webp;
}

/** JS artwork imports share one format choice across DOM, Pixi, 3D and preloading. */
export function artworkBuildPlugin(): Plugin {
  let config: ResolvedConfig;
  let pending = Promise.resolve();
  const assets = new Set<string>();
  return {
    name: 'petit-lossless-artwork',
    apply: 'build',
    enforce: 'pre',
    configResolved(value) { config = value; },
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace('src="/src/main.tsx"', 'src="/src/bootstrap.ts"'),
    },
    async load(id) {
      const [file, query = ''] = id.split('?');
      if (!file || !file.startsWith(resolve(config.root, 'src/assets') + '/') || !/\/(?:icons|shell)\/.*\.png$/.test(file)) return null;
      if (query && query !== 'url') return null;
      const source = await readFile(file);
      // Preserve Vite's small, inline assets and their existing cache granularity.
      const limit = config.build.assetsInlineLimit;
      if (typeof limit === 'function' ? limit(file, source) : source.length < limit) return null;
      let optimized: Uint8Array | null = null;
      // Bound native encoder memory independently of the bundler's module concurrency.
      const work = pending.then(async () => { optimized = await losslessArtwork(source); });
      pending = work.catch(() => {});
      await work;
      if (!optimized) return null;
      const png = this.emitFile({ type: 'asset', name: basename(file), source });
      const webp = this.emitFile({ type: 'asset', name: basename(file, '.png') + '.webp', source: optimized });
      assets.add(png);
      assets.add(webp);
      const runtime = resolve(config.root, 'src/assets/image-format.ts');
      return `import { supportsLosslessWebp } from ${JSON.stringify(runtime)};\nexport default supportsLosslessWebp ? import.meta.ROLLUP_FILE_URL_${webp} : import.meta.ROLLUP_FILE_URL_${png};`;
    },
    resolveFileUrl({ referenceId, fileName, relativePath }) {
      if (!assets.has(referenceId)) return null;
      return config.base === './' || config.base === ''
        ? `new URL(${JSON.stringify(relativePath)}, import.meta.url).href`
        : JSON.stringify(config.base + fileName);
    },
  };
}
