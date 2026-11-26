import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { LiteHostId } from '../src/platform/build/lite-hosts.ts';

/** Build-time adapters keep unavailable dependencies out of the offline graph. */
export const liteAliases = [
  { find: /^.*\/providers-list$/, replacement: resolve('src/legal/providers-list-lite.ts') },
  { find: /^pixi\.js-legacy$/, replacement: resolve('src/view/map2d/pixi-lite.ts') },
  { find: /^.*\/edition-surfaces$/, replacement: resolve('src/ui/lite/edition-surfaces.tsx') },
  { find: /^.*\/reel-files$/, replacement: resolve('src/ui/lite/tour-reel-files.ts') },
  { find: /^.*\/edition-review$/, replacement: resolve('src/editor/review/edition-review-lite.ts') },
  // The text check's worker, named by `pipelines/moderation/text/` and its doors.
  { find: /^\.(?:\/text)?\/reviewer$/, replacement: resolve('src/pipelines/moderation/text/reviewer-lite.ts') },
  { find: /^.*\/use-stylize-versions$/, replacement: resolve('src/ui/lite/use-stylize-versions.ts') },
  { find: /^.*\/edition-help$/, replacement: resolve('src/ui/lite/edition-help.tsx') },
  { find: /^.*\/glyph\/decode-async$/, replacement: resolve('src/io/share/glyph/decode-async-lite.ts') },
  { find: /^.*\/record-compress$/, replacement: resolve('src/io/storage/record-compress-lite.ts') },
  { find: /^.*\/candidate-pool$/, replacement: resolve('src/tools/generation/run/candidate-pool-lite.ts') },
  { find: /^.*\/scene-world-builder$/, replacement: resolve('src/editor/sandbox/scene-world-builder-lite.ts') },
  { find: /^.*\/planet\/PlanetImportWindow$/, replacement: resolve('src/ui/lite/planet-import-window.tsx') },
  { find: /^.*\/clipper-loader$/, replacement: resolve('src/view/shared/road/clipper-loader-lite.ts') },
];

/** Each Lite host's own adapters, ahead of the shared ones; a host without an entry uses the modules as written. */
export const LITE_HOST_ALIASES: Readonly<Record<LiteHostId, readonly { find: RegExp; replacement: string }[]>> = {
  xhs: [],
  bilibili: [
    { find: /^.*\/host-deliveries$/, replacement: resolve('src/editor/export/host-deliveries-bilibili.ts') },
    { find: /^.*\/host-bridge$/, replacement: resolve('src/platform/host/host-bridge-bilibili.ts') },
    // Typed text is checked once committed, which keeps to the Toy SDK check's rate limit.
    { find: /^.*\/edition-review$/, replacement: resolve('src/editor/review/edition-review-bilibili.ts') },
  ],
};

/** Modules only a Lite build loads: the Lite folders, the `-lite` adapters, and a container's deliveries and picture recovery. */
const LITE_ONLY = /\/src\/(?:ui\/lite\/|lite\/|editor\/export\/host-deliveries|platform\/async\/art-recovery\.|.*-lite\.tsx?$)/;

/** An ordinary web build must never inherit container shims or offline adapters. */
export function webEditionBoundary(): Plugin {
  return {
    name: 'petit-web-edition-boundary',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(item.modules)) {
          if (module.renderedLength && LITE_ONLY.test(id)) {
            this.error(`Offline adapter in web build: ${id}`);
          }
        }
      }
    },
  };
}
