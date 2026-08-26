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
  /** `<meta name="keywords">`. Dead weight to Google, still read by Baidu and Sogou, which are the
   *  engines the mainland site is found through — so both sites carry both names of everything. */
  keywords: string;
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
  /** The privacy policy's "where data goes" section names the host and where its edge runs, and
   *  both facts differ per deployment: the global site rides a network with no mainland nodes, the
   *  mainland site one with them, and each policy must state its own truth. The `{hostNetwork}` and
   *  `{edgeDelivery}` tokens in `content/privacy.*.md` resolve from here. */
  privacyHostNetwork: { en: string; zh: string };
  privacyEdgeDelivery: { en: string; zh: string };
  /** The boot loader's and splash's masthead file (under `public/`). The zh art carries the
   *  Chinese wordmark; the mainland deployment leads with it the way its title does. */
  bootBanner: string;
}

// The zh description also names the game in Latin: the title speaks one language per site, and the
// mainland description is where a search for the game's other name still finds that page. The en
// side stays pure English (its `keywords` meta carries the Chinese names for the engines that read
// one).
const EN_DESCRIPTION =
  'Plan a Petit Planet island in your browser, then build it in the game. '
  + 'Draw terrain and water, place buildings and roads, generate an island, and edit in 2D or 3D.';
const ZH_DESCRIPTION =
  '星布谷地（Petit Planet）地图规划工具：在浏览器里规划好一座岛，再到游戏里照着搭。'
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
    keywords: 'Petit Planet, 星布谷地, map editor, map planner, PetitMaker, 谷地工坊, 地图编辑器, HoYoverse',
    canonicalOrigin: 'https://petit-maker.com',
    legacyOrigins: [],
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    privacyHostNetwork: {
      en: "Cloudflare's network (Workers static asset hosting)",
      zh: '由 Cloudflare 的网络分发（Workers 静态资源托管）',
    },
    privacyEdgeDelivery: {
      en: "Those static files are delivered from whichever of Cloudflare's edge locations is nearest to you. That network has no locations in mainland China, so a request made from mainland China is served from outside it.",
      zh: '上述静态文件由距离你最近的 Cloudflare 边缘节点分发。该网络在中国大陆没有节点，因此来自中国大陆的请求会由中国大陆以外的节点处理。',
    },
    bootBanner: 'banner.svg',
  },
  // Aliyun, for mainland users. Chinese leads, and the filing rows are the legal requirement for
  // serving from there at all. The PSB pair stays null until that filing is granted, and the
  // release validator refuses a production build with a half-filled pair.
  cn: {
    id: 'cn',
    htmlLang: 'zh-CN',
    title: '谷地工坊：星布谷地地图编辑器',
    description: ZH_DESCRIPTION,
    keywords: '星布谷地, 地图编辑器, 谷地工坊, 星布谷地地图, 建图工具, Petit Planet, PetitMaker, 米哈游',
    canonicalOrigin: 'https://petitmaker.com.cn',
    legacyOrigins: [],
    icpNumber: '浙ICP备2026062928号-1',
    icpUrl: 'https://beian.miit.gov.cn/',
    psbNumber: null,
    psbUrl: null,
    privacyHostNetwork: {
      en: "Alibaba Cloud's edge network (ESA Pages static hosting)",
      zh: '由阿里云边缘网络分发（ESA Pages 静态托管）',
    },
    privacyEdgeDelivery: {
      en: "Those static files are delivered from whichever of Alibaba Cloud's edge locations is nearest to you, including locations inside mainland China, so a request made from mainland China is ordinarily served within it.",
      zh: '上述静态文件由距离你最近的阿里云边缘节点分发，其中包括位于中国大陆境内的节点，因此来自中国大陆的请求通常在境内处理。',
    },
    bootBanner: 'banner-zh.svg',
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
