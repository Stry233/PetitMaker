/**
 * The containers the Lite edition is packaged for, and what each one lets it offer.
 *
 * `edition.ts` turns the host of this build into capabilities; interface code asks those and never
 * reads a host. The build, the packager and the verification read the same table; a bundle keeps only its
 * own host's entry (`activeLiteHost`).
 */
export type LiteHostId = 'xhs' | 'bilibili';

export interface LiteHost {
  id: LiteHostId;
  /** Reading a map back from its exported picture, which the visitor picks from the device. */
  pictureImport: boolean;
  /** Letter generation, which lays words the visitor may type. */
  letterGeneration: boolean;
  /** Picture generation from the package's own character portraits; no released build takes a picture
   *  of the visitor's own there (`editor/editing/custom-card.ts:hasCustomCard`). */
  pictureGeneration: boolean;
  /** Whether a player types the author a blueprint names; a platform that forbids names players make
   *  up gives the player's own, or the blueprint stays anonymous. */
  typedAuthor: boolean;
  /** Saving the exported picture as a browser download where the container offers no album. */
  pictureDownload: boolean;
  /** The platform script the entry page loads ahead of the app, at exactly this address; null where
   *  the container provides its bridge itself. */
  sdkScript: string | null;
  /** The platform's names, as each locale writes them, and its link domains, matched without case. Each
   *  platform forbids naming another, so packaging refuses another host's package that carries one
   *  (`scripts/lite-validation.mts:otherPlatformNames`). */
  names: readonly string[];
}

// Xiaohongshu's mini-tool container injects `window.xhs.miniTool` and serves nothing from outside the package.
const XHS: LiteHost = {
  id: 'xhs', pictureImport: true, letterGeneration: true, pictureGeneration: true, typedAuthor: true, pictureDownload: false, sdkScript: null,
  names: ['Xiaohongshu', 'RedNote', 'XHS', '小红书', '小紅書', 'シャオホンシュ', 'Сяохуншу', 'เสี่ยวหงซู', 'xhscdn.com', 'xhslink.com'],
};
// Bilibili Toy refuses picture uploads from visitors and nicknames players make up, and lets pictures be
// saved locally; its SDK defines `window.toy`, whose album exists only inside the Bilibili app.
const BILIBILI: LiteHost = {
  id: 'bilibili', pictureImport: false, letterGeneration: true, pictureGeneration: true, typedAuthor: false, pictureDownload: true,
  sdkScript: 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js',
  names: ['Bilibili', 'B站', '哔哩哔哩', '嗶哩嗶哩', 'ビリビリ', 'Билибили', 'บิลิบิลิ', 'b23.tv', 'hdslb.com'],
};

export const LITE_HOSTS: Readonly<Record<LiteHostId, LiteHost>> = { xhs: XHS, bilibili: BILIBILI };

/** The host a build without `PETIT_LITE_HOST` is for. */
export const DEFAULT_LITE_HOST: LiteHostId = 'xhs';

/** The host named `id`, the default one where none is named. An unknown name throws, so a misspelt
 *  host never builds another host's package. */
export function liteHostById(id: string | undefined | null): LiteHost {
  if (!id) return LITE_HOSTS[DEFAULT_LITE_HOST];
  if (!(Object.keys(LITE_HOSTS) as string[]).includes(id)) throw new Error(`Unknown Lite host "${id}"; expected one of ${Object.keys(LITE_HOSTS).join(', ')}`);
  return LITE_HOSTS[id as LiteHostId];
}

/** Node-based tools read the environment where no build define ran. */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** The host this build is for: Vite's define in the bundle, `PETIT_LITE_HOST` in Node. Read at call
 *  time, so a test may stub the global. Each host is compared by its literal id, so a bundle's define
 *  folds this to its own entry and the build drops every other host's, the table included. */
export function activeLiteHost(): LiteHost {
  if (typeof __PETIT_LITE_HOST__ === 'string') {
    return __PETIT_LITE_HOST__ === 'bilibili' ? BILIBILI : __PETIT_LITE_HOST__ === 'xhs' ? XHS : liteHostById(__PETIT_LITE_HOST__);
  }
  return liteHostById(typeof process !== 'undefined' ? process.env?.PETIT_LITE_HOST : undefined);
}
