/**
 * The two places this app is deployed, and everything that differs between them.
 *
 * One repo, two artifacts. `PETIT_TARGET` picks a row at build time and BOTH surfaces read it: the
 * crawler-facing head of index.html (generated in vite.config — a title and description have to be
 * in the static file, so they cannot be chosen at runtime) and `LEGAL` (the filing bar, the
 * canonical URLs, the doc footers). Stating a fact once here is what keeps the head and the app
 * from disagreeing about which site they are.
 *
 * The split is not cosmetic: a mainland deployment carries an ICP filing and a PSB filing that the
 * global one must NOT display, and each site needs its own canonical URL or the two compete for the
 * same search results.
 */

export type DeployTargetId = 'global' | 'cn';

export interface DeployTarget {
  id: DeployTargetId;
  /** `<html lang>` — the language a crawler should assume before the app picks one. */
  htmlLang: string;
  /** `<title>`. Both product names appear on both sites: this is a single page that switches
   *  language in place, so there is no second URL for either name to be found at. */
  title: string;
  /** `<meta name="description">` and the link preview. */
  description: string;
  /** THE one place this deployment's URL is written. */
  canonicalOrigin: string;
  /** Domains this deployment used to be served from; the runbook turns these into 301s. */
  legacyOrigins: readonly string[];
  /** Mainland filing rows. Null on a deployment that has no filing to show — rendering an empty
   *  filing bar would claim a registration that does not exist. */
  icpNumber: string | null;
  icpUrl: string | null;
  psbNumber: string | null;
  psbUrl: string | null;
}

const EN_DESCRIPTION =
  'Plan a Petit Planet island in your browser, then build it in the game. '
  + 'Draw terrain and water, place buildings and roads, generate an island, and edit in 2D or 3D.';
const ZH_DESCRIPTION =
  '星布谷地地图规划工具：在浏览器里规划好一座岛，再到游戏里照着搭。'
  + '绘制地形与水系、摆放建筑与道路、生成整座岛屿，并可在 2D 与 3D 视图中编辑。';

export const DEPLOY_TARGETS: Record<DeployTargetId, DeployTarget> = {
  // Cloudflare, for everyone outside the mainland. Each deployment speaks ONE language: two sites
  // means each has an audience, and a bilingual title reads as a mistake in the tab of whichever
  // reader you have. The other language is reachable in the app, which retitles on the locale.
  global: {
    id: 'global',
    htmlLang: 'en',
    title: 'PetitMaker: Petit Planet Map Editor',
    description: EN_DESCRIPTION,
    canonicalOrigin: 'https://petit-maker.com',
    legacyOrigins: [],
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
  },
  // Aliyun, for mainland users. Chinese leads, and the filing rows are the legal requirement for
  // serving from there at all. The PSB pair stays null until that filing is granted, and the
  // release validator refuses a production build with a half-filled pair.
  cn: {
    id: 'cn',
    htmlLang: 'zh-CN',
    title: '谷地工坊：星布谷地地图编辑器',
    description: ZH_DESCRIPTION,
    canonicalOrigin: 'https://petitmaker.com.cn',
    legacyOrigins: [],
    icpNumber: '浙ICP备2026062928号-1',
    icpUrl: 'https://beian.miit.gov.cn/',
    psbNumber: null,
    psbUrl: null,
  },
};

/** Injected by vite's `define` in a bundle; absent in a node script, which reads the env instead.
 *  `process` is declared locally rather than pulling in node types: this module is bundled for the
 *  browser, where the name does not exist at all. */
declare const __PETIT_TARGET__: string | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** Normalize any spelling of the target to a row that exists; anything unrecognized is the global
 *  build, which is the one that carries no filing claims. */
export function targetById(id: string | undefined | null): DeployTarget {
  return id === 'cn' ? DEPLOY_TARGETS.cn : DEPLOY_TARGETS.global;
}

/** The target this build is for. */
export function activeTarget(): DeployTarget {
  const fromBundle = typeof __PETIT_TARGET__ === 'string' ? __PETIT_TARGET__ : undefined;
  const fromEnv = typeof process !== 'undefined' ? process.env?.PETIT_TARGET : undefined;
  return targetById(fromBundle ?? fromEnv);
}
