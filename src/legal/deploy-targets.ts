/** Deployment metadata shared by the generated document head and the in-app legal surfaces. */

export type DeployTargetId = 'global' | 'cn';

export interface DeployTarget {
  id: DeployTargetId;
  /** Language presented to crawlers before the app selects a locale. */
  htmlLang: string;
  /** Static page title. */
  title: string;
  /** Public masthead shared by the initial loading screen and the React splash. */
  bootBanner: string;
  /** Search description and link-preview text. */
  description: string;
  /** Canonical HTTPS origin without a trailing slash. */
  canonicalOrigin: string;
  /** Former deployment domains that receive permanent redirects to the canonical origin. */
  legacyOrigins: readonly string[];
  /** Mainland filing rows; each number and URL are either both present or both null. */
  icpNumber: string | null;
  icpUrl: string | null;
  psbNumber: string | null;
  psbUrl: string | null;
  /** Localized hosting and edge-delivery facts inserted into the privacy policy. */
  privacyHostNetwork: { en: string; zh: string };
  privacyEdgeDelivery: { en: string; zh: string };
  /** Search-engine ownership proofs emitted as static `<meta name content>` pairs. */
  verificationMetas: readonly { name: string; content: string }[];
  /** Browser download pages reachable from this deployment's region. */
  browserDownloads: { chrome: string; firefox: string };
}

const EN_DESCRIPTION =
  'PetitMaker is a free online map editor and planet planner for Petit Planet. '
  + 'Design terrain, waterways, roads and buildings, then preview, save and share your planet in 2D or 3D.';
const ZH_DESCRIPTION =
  '谷地工坊是一款免费的星布谷地地图编辑器与星球规划工具。在线绘制地形、水系、道路和建筑，并使用 2D、3D 视图预览、保存和分享你的星球地图。';

export const DEPLOY_TARGETS: Record<DeployTargetId, DeployTarget> = {
  global: {
    id: 'global',
    htmlLang: 'en',
    title: 'PetitMaker — Petit Planet Map Editor & Planet Planner',
    bootBanner: 'banner.svg',
    description: EN_DESCRIPTION,
    canonicalOrigin: 'https://petitmaker.cc',
    browserDownloads: { chrome: 'https://www.google.com/chrome/', firefox: 'https://www.mozilla.org/firefox/new/' },
    legacyOrigins: ['https://petit-maker.com'],
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    privacyHostNetwork: {
      en: "Cloudflare's network (Workers static asset hosting)",
      zh: '由 Cloudflare 的网络分发（Workers 静态资源托管）',
    },
    privacyEdgeDelivery: {
      en: "Those static files are delivered from a nearby Cloudflare edge location. This deployment does not use Cloudflare's China Network, so requests from mainland China are served from outside mainland China.",
      zh: '上述静态文件由附近的 Cloudflare 边缘节点分发。本站未使用 Cloudflare 中国网络，因此来自中国大陆的请求会在境外处理。',
    },
    verificationMetas: [],
  },
  cn: {
    id: 'cn',
    htmlLang: 'zh-CN',
    title: '谷地工坊 - 星布谷地地图编辑器｜星球规划与 2D/3D 预览',
    bootBanner: 'banner-zh.svg',
    description: ZH_DESCRIPTION,
    canonicalOrigin: 'https://petitmaker.com.cn',
    browserDownloads: { chrome: 'https://www.google.cn/chrome/', firefox: 'https://www.firefox.com.cn/' },
    legacyOrigins: [],
    icpNumber: '浙ICP备2026062928号-1',
    icpUrl: 'https://beian.miit.gov.cn/',
    // No PSB (公安联网备案) filing: Article 12 of the 计算机信息网络国际联网安全保护管理办法 places
    // that duty on 互联单位、接入单位 and 使用计算机信息网络国际联网的法人和其他组织, not on natural
    // persons, and this site is filed under an individual's ICP record.
    // https://www.cac.gov.cn/2014-10/08/c_1112737294.htm
    psbNumber: null,
    psbUrl: null,
    privacyHostNetwork: {
      en: "Alibaba Cloud's edge network (ESA Pages static hosting)",
      zh: '由阿里云边缘网络分发（ESA Pages 静态托管）',
    },
    privacyEdgeDelivery: {
      en: "This deployment uses Alibaba Cloud ESA's mainland China service region. Its static files are delivered from edge locations inside mainland China, so requests from mainland China are ordinarily handled there.",
      zh: '本站使用阿里云 ESA 的中国内地服务区域。静态文件由中国大陆境内的边缘节点分发，因此来自中国大陆的请求通常在境内处理。',
    },
    verificationMetas: [{ name: 'baidu-site-verification', content: 'codeva-jY3ZDA0Q7F' }],
  },
};

/** Vite injects the build target; Node-based generators read the environment fallback. */
declare const __PETIT_TARGET__: string | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;

/** Resolve unknown targets to the filing-free global deployment. */
export function targetById(id: string | undefined | null): DeployTarget {
  return id === 'cn' ? DEPLOY_TARGETS.cn : DEPLOY_TARGETS.global;
}

/** The target this build is for. */
export function activeTarget(): DeployTarget {
  const fromBundle = typeof __PETIT_TARGET__ === 'string' ? __PETIT_TARGET__ : undefined;
  const fromEnv = typeof process !== 'undefined' ? process.env?.PETIT_TARGET : undefined;
  return targetById(fromBundle ?? fromEnv);
}
