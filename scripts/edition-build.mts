import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Build-time adapters keep unavailable dependencies out of the offline graph. */
export const liteAliases = [
  { find: /^.*\/providers-list$/, replacement: resolve('src/legal/providers-list-lite.ts') },
  { find: /^pixi\.js-legacy$/, replacement: resolve('src/view/map2d/pixi-lite.ts') },
  { find: /^.*\/edition-surfaces$/, replacement: resolve('src/ui/lite/edition-surfaces.tsx') },
  { find: /^.*\/edition-export$/, replacement: resolve('src/ui/lite/edition-export.ts') },
  { find: /^.*\/edition-review$/, replacement: resolve('src/editor/review/edition-review-lite.ts') },
  { find: /^.*\/use-stylize-versions$/, replacement: resolve('src/ui/lite/use-stylize-versions.ts') },
  { find: /^.*\/edition-help$/, replacement: resolve('src/ui/lite/edition-help.tsx') },
  { find: /^.*\/glyph\/decode-async$/, replacement: resolve('src/io/share/glyph/decode-async-lite.ts') },
  { find: /^.*\/record-compress$/, replacement: resolve('src/io/storage/record-compress-lite.ts') },
  { find: /^.*\/candidate-pool$/, replacement: resolve('src/tools/generation/run/candidate-pool-lite.ts') },
  { find: /^.*\/planet\/PlanetImportWindow$/, replacement: resolve('src/ui/lite/planet-import-window.tsx') },
  { find: /^.*\/clipper-loader$/, replacement: resolve('src/view/shared/road/clipper-loader-lite.ts') },
];

/** An ordinary web build must never inherit container shims or offline adapters. */
export function webEditionBoundary(): Plugin {
  return {
    name: 'petit-web-edition-boundary',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(item.modules)) {
          if (module.renderedLength && /\/src\/(?:ui\/lite\/|lite\/|.*-lite\.tsx?$)/.test(id)) {
            this.error(`Offline adapter in web build: ${id}`);
          }
        }
      }
    },
  };
}
