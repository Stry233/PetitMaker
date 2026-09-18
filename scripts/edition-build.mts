import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Build-time adapters keep unavailable dependencies out of the offline graph. */
export const liteAliases = [
  { find: /^.*\/providers-list$/, replacement: resolve('src/legal/providers-list-lite.ts') },
  { find: /^pixi\.js-legacy$/, replacement: resolve('src/canvas/pixi-lite.ts') },
  { find: /^.*\/edition-surfaces$/, replacement: resolve('src/ui/lite/edition-surfaces.tsx') },
  { find: /^.*\/edition-export$/, replacement: resolve('src/ui/lite/edition-export.ts') },
  { find: /^.*\/use-stylize-versions$/, replacement: resolve('src/ui/lite/use-stylize-versions.ts') },
  { find: /^.*\/edition-help$/, replacement: resolve('src/ui/lite/edition-help.tsx') },
  { find: /^.*\/glyph\/decode-async$/, replacement: resolve('src/io/share/glyph/decode-async-lite.ts') },
  { find: /^.*\/autosave-worker$/, replacement: resolve('src/io/autosave-worker-lite.ts') },
  { find: /^.*\/candidate-pool$/, replacement: resolve('src/kit/operations/candidate-pool-lite.ts') },
];

/** An ordinary web build must never inherit container shims or offline adapters. */
export function webEditionBoundary(): Plugin {
  return {
    name: 'petit-web-edition-boundary',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(item.modules)) {
          if (module.renderedLength && /\/src\/(?:ui\/lite\/|lite\.tsx$|.*-lite\.tsx?$)/.test(id)) {
            this.error(`Offline adapter in web build: ${id}`);
          }
        }
      }
    },
  };
}
