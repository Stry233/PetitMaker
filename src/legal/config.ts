import { APP_NAME } from '../i18n/brand';
import { activeTarget, type DeployTargetId } from '../platform/build/deploy-targets';

/** Shared facts for legal documents, About, filing rows and generated site metadata. */
/** A person the About surfaces credit. `sort` is the lowercase romanization they are ordered by;
 *  `bilibili` is their Bilibili mid, which names both their space and their bundled avatar. */
export interface CreditedMember { name: string; sort: string; bilibili: string }

/** A credited member's Bilibili space. */
export function memberUrl(member: Pick<CreditedMember, 'bilibili'>): string {
  return `https://space.bilibili.com/${member.bilibili}`;
}

export type LegalConfig = {
  /** HTTPS origin without a trailing slash. */
  canonicalOrigin: string;
  /** Former origins that require path-preserving edge redirects. */
  legacyOrigins: readonly string[];
  productName: string;

  /** The operator's public name in each document language. */
  operatorName: { en: string; zh: string };
  privacyContactEmail: string;
  securityContactEmail: string;
  qqFeedbackChannel: string;

  icpNumber: string | null;
  icpUrl: string | null;
  psbNumber: string | null;
  psbUrl: string | null;
  /** The active deployment's hosting disclosures for the privacy notice. */
  privacyHostNetwork: { en: string; zh: string };
  privacyEdgeDelivery: { en: string; zh: string };

  /** A material policy revision advances its date and version together. */
  effectiveDates: {
    privacy: string;
    terms: string;
  };
  policyVersions: {
    privacy: string;
    terms: string;
  };

  team: ReadonlyArray<CreditedMember>;
  /** Community members thanked on the About surfaces; same shape and ordering rule as `team`. */
  acknowledgements: ReadonlyArray<CreditedMember>;
  repoUrl: string;
  sponsorship: { patreon: string; afdian: string };
};

/** Each deployment's hosting and edge-delivery disclosures, as the privacy notice states them. */
export const PRIVACY_HOSTING: Readonly<Record<DeployTargetId, Pick<LegalConfig, 'privacyHostNetwork' | 'privacyEdgeDelivery'>>> = {
  global: {
    privacyHostNetwork: {
      en: "Cloudflare's network (Workers static asset hosting)",
      zh: '由 Cloudflare 的网络分发（Workers 静态资源托管）',
    },
    privacyEdgeDelivery: {
      en: "Those static files are delivered from a nearby Cloudflare edge location. This deployment does not use Cloudflare's China Network, so requests from mainland China are served from outside mainland China.",
      zh: '上述静态文件由附近的 Cloudflare 边缘节点分发。本站未使用 Cloudflare 中国网络，因此来自中国大陆的请求会在境外处理。',
    },
  },
  cn: {
    privacyHostNetwork: {
      en: "Alibaba Cloud's edge network (ESA Pages static hosting)",
      zh: '由阿里云边缘网络分发（ESA Pages 静态托管）',
    },
    privacyEdgeDelivery: {
      en: "This deployment uses Alibaba Cloud ESA's mainland China service region. Its static files are delivered from edge locations inside mainland China, so requests from mainland China are ordinarily handled there.",
      zh: '本站使用阿里云 ESA 的中国内地服务区域。静态文件由中国大陆境内的边缘节点分发，因此来自中国大陆的请求通常在境内处理。',
    },
  },
};

/** The active deployment owns its origin and filing facts. */
const TARGET = activeTarget();

export const LEGAL: LegalConfig = {
  canonicalOrigin: TARGET.canonicalOrigin,
  legacyOrigins: TARGET.legacyOrigins,
  productName: APP_NAME,

  operatorName: { en: 'PetitMaker Team', zh: '谷地工坊团队' },
  privacyContactEmail: 'petit.maker@outlook.com',
  securityContactEmail: 'petit.maker@outlook.com',
  qqFeedbackChannel: 'pd76247629',

  icpNumber: TARGET.icpNumber,
  icpUrl: TARGET.icpUrl,
  psbNumber: TARGET.psbNumber,
  psbUrl: TARGET.psbUrl,
  ...PRIVACY_HOSTING[TARGET.id],

  effectiveDates: {
    privacy: '2026-10-02',
    terms: '2026-09-13',
  },
  policyVersions: {
    privacy: '1.8',
    terms: '1.3',
  },

  // Each surface sorts this roster by `sort` before display.
  team: [
    { name: '镜喵MirrorCat', sort: 'jingmiaomirrorcat', bilibili: '25599535' },
    { name: '鱼松吃点吗', sort: 'yusongchidianma', bilibili: '3632319829116985' },
    { name: '火山野牛王', sort: 'huoshanyeniuwang', bilibili: '16699168' },
    { name: 'Selka', sort: 'selka', bilibili: '3546659724200757' },
  ],
  acknowledgements: [
    { name: '晶焰EXFire', sort: 'jingyanexfire', bilibili: '215541807' },
    { name: '奕言君', sort: 'yiyanjun', bilibili: '397542864' },
    { name: '星灭散落', sort: 'xingmiesanluo', bilibili: '671142687' },
  ],
  repoUrl: 'https://github.com/Stry233/PetitMaker',
  sponsorship: {
    patreon: 'https://www.patreon.com/c/PetitMaker',
    afdian: 'https://afdian.com/a/PetitMaker',
  },
};
