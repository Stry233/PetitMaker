import { APP_NAME } from '../version';
import { activeTarget } from './deploy-targets';

/** Shared facts for legal documents, About, filing rows and generated site metadata. */
export type LegalConfig = {
  /** HTTPS origin without a trailing slash. */
  canonicalOrigin: string;
  /** Former origins that require path-preserving edge redirects. */
  legacyOrigins: readonly string[];
  productName: string;

  /** English and Chinese public names separated by ` / ` for locale selection. */
  operatorDisplayName: string;
  privacyContactEmail: string;
  securityContactEmail: string;

  icpNumber: string | null;
  icpUrl: string | null;
  psbNumber: string | null;
  psbUrl: string | null;

  /** A material policy revision advances its date and version together. */
  effectiveDates: {
    privacy: string;
    terms: string;
  };
  policyVersions: {
    privacy: string;
    terms: string;
  };

  /** `sort` is lowercase romanization; `avatar` is the member's Bilibili MID. */
  team: ReadonlyArray<{ name: string; sort: string; url: string; avatar?: string }>;
  repoUrl: string;
  sponsorship: { patreon: string; afdian: string };
};

/** The active deployment owns its origin and filing facts. */
const TARGET = activeTarget();

export const LEGAL: LegalConfig = {
  canonicalOrigin: TARGET.canonicalOrigin,
  legacyOrigins: TARGET.legacyOrigins,
  productName: APP_NAME,

  operatorDisplayName: 'PetitMaker Team / 谷地工坊团队',
  privacyContactEmail: 'selka.craft@outlook.com',
  securityContactEmail: 'selka.craft@outlook.com',

  icpNumber: TARGET.icpNumber,
  icpUrl: TARGET.icpUrl,
  psbNumber: TARGET.psbNumber,
  psbUrl: TARGET.psbUrl,

  effectiveDates: {
    privacy: '2026-09-03',
    terms: '2026-09-03',
  },
  policyVersions: {
    privacy: '1.3',
    terms: '1.1',
  },

  // Each surface sorts this roster by `sort` before display.
  team: [
    { name: '镜喵MirrorCat', sort: 'jingmiaomirrorcat', url: 'https://space.bilibili.com/25599535', avatar: '25599535' },
    { name: '鱼松吃点吗', sort: 'yusongchidianma', url: 'https://space.bilibili.com/3632319829116985', avatar: '3632319829116985' },
    { name: '火山野牛王', sort: 'huoshanyeniuwang', url: 'https://space.bilibili.com/16699168', avatar: '16699168' },
    { name: 'Selka', sort: 'selka', url: 'https://space.bilibili.com/3546659724200757', avatar: '3546659724200757' },
  ],
  repoUrl: 'https://github.com/Stry233/PetitMaker',
  sponsorship: {
    patreon: 'https://www.patreon.com/c/PetitMaker',
    afdian: 'https://afdian.com/a/PetitMaker',
  },
};
