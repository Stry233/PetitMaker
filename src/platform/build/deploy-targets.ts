/** Deployment metadata shared by the generated document head and the in-app legal surfaces. */
import { bundledTargetId } from './target.ts';

export type DeployTargetId = 'global' | 'cn';

export interface DeployTarget {
  id: DeployTargetId;
  /** Language presented to crawlers before the app selects a locale. */
  htmlLang: string;
  /** The deployment's primary language: its brand name, its indexable pages and its link previews. */
  lang: 'en' | 'zh';
  /** Whether document URLs end in a slash: ESA serves directory indexes with one, Cloudflare the
   *  unslashed path. */
  trailingSlash: boolean;
  /** Other names the site answers to in its structured data. */
  alternateNames: readonly string[];
  /** Static page title. */
  title: string;
  /** Public masthead shared by the initial loading screen and the React splash. */
  bootBanner: string;
  /** Canonical HTTPS origin without a trailing slash. */
  canonicalOrigin: string;
  /** Former deployment domains that receive permanent redirects to the canonical origin. */
  legacyOrigins: readonly string[];
  /** Mainland filing rows; each number and URL are either both present or both null. */
  icpNumber: string | null;
  icpUrl: string | null;
  psbNumber: string | null;
  psbUrl: string | null;
  /** Search-engine ownership proofs emitted as static `<meta name content>` pairs. */
  verificationMetas: readonly { name: string; content: string }[];
  /** Browser download pages reachable from this deployment's region. */
  browserDownloads: { chrome: string; firefox: string };
  /** Whether visitors can reach the live model catalog reliably; one that cannot reads the extract
   *  refreshed at release. */
  liveModelCatalog: boolean;
}

export const DEPLOY_TARGETS: Record<DeployTargetId, DeployTarget> = {
  global: {
    id: 'global',
    htmlLang: 'en',
    lang: 'en',
    trailingSlash: false,
    alternateNames: ['Petit Maker', 'PetitMaker Map Editor', 'petitmaker.cc'],
    title: 'PetitMaker - Petit Planet Map Editor & Planet Planner',
    bootBanner: 'banner.svg',
    canonicalOrigin: 'https://petitmaker.cc',
    browserDownloads: { chrome: 'https://www.google.com/chrome/', firefox: 'https://www.mozilla.org/firefox/new/' },
    legacyOrigins: ['https://petit-maker.com'],
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    verificationMetas: [],
    liveModelCatalog: true,
  },
  cn: {
    id: 'cn',
    htmlLang: 'zh-CN',
    lang: 'zh',
    trailingSlash: true,
    alternateNames: ['PetitMaker'],
    title: '谷地工坊 - 星布谷地地图编辑器｜星球规划与 2D/3D 预览',
    bootBanner: 'banner-zh.svg',
    canonicalOrigin: 'https://petitmaker.com.cn',
    browserDownloads: { chrome: 'https://www.google.cn/chrome/', firefox: 'https://www.firefox.com.cn/' },
    legacyOrigins: [],
    icpNumber: '浙ICP备2026062928号-1',
    icpUrl: 'https://beian.miit.gov.cn/',
    // No PSB (public security network) filing: Article 12 of the Measures for the Security Protection
    // Administration of International Networking of Computer Information Networks places that duty on
    // interconnecting units, access units and the legal persons and other organisations using such
    // networks, not on natural persons, and this site is filed under an individual's ICP record.
    // https://www.cac.gov.cn/2014-10/08/c_1112737294.htm
    psbNumber: null,
    psbUrl: null,
    verificationMetas: [{ name: 'baidu-site-verification', content: 'codeva-jY3ZDA0Q7F' }],
    liveModelCatalog: false,
  },
};

/** Vite injects the build target; Node-based generators read the environment fallback. */
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** Resolve unknown targets to the filing-free global deployment. */
export function targetById(id: string | undefined | null): DeployTarget {
  return id === 'cn' ? DEPLOY_TARGETS.cn : DEPLOY_TARGETS.global;
}

/** The target this build is for. */
export function activeTarget(): DeployTarget {
  const fromBundle = bundledTargetId();
  const fromEnv = typeof process !== 'undefined' ? process.env?.PETIT_TARGET : undefined;
  return targetById(fromBundle ?? fromEnv);
}

/** The deployment serving `origin`; an origin no deployment owns reads as the global one. */
export function targetOfOrigin(origin: string): DeployTarget {
  return Object.values(DEPLOY_TARGETS).find((t) => t.canonicalOrigin === origin) ?? DEPLOY_TARGETS.global;
}
