import { APP_NAME } from '../version';

/**
 * The single structured source for every legal/filing fact the app surfaces:
 * the About modal's filing rows, the static legal-page footers, and the
 * persistent `LegalBar`. Nothing downstream hardcodes these values — they all
 * read `LEGAL` (or a locale-scoped view of it) so there is exactly one place
 * to correct before launch.
 *
 * SINGLE-SOURCE URL POLICY (site + repo). `canonicalOrigin` is THE one place
 * the live-site URL is written, and `repoUrl` THE one place the repository URL
 * is written. Every dependent surface derives from here rather than hardcoding
 * a literal:
 *   - the legal doc bodies (src/legal/content/*.md) use the `{origin}` token, which
 *     the registry substitutes from `canonicalOrigin`;
 *   - the static-page generator, sitemap, robots.txt, and security.txt all read
 *     `cfg.canonicalOrigin`;
 *   - the About modal / LegalDocView "open the page" links and © footer read
 *     `LEGAL.canonicalOrigin` / `LEGAL.repoUrl` directly.
 * The two files that CANNOT be token-processed — README.md / README.zh-CN.md
 * (plain GitHub markdown) — are instead pinned by a drift-guard test
 * (src/__tests__/legal/readme-links.test.ts): every literal site URL in them
 * must equal `canonicalOrigin` and every repo URL must equal `repoUrl`, so
 * changing a value HERE fails that test until the READMEs are updated. Do not
 * paste the literal domain anywhere else.
 */
export type LegalConfig = {
  canonicalOrigin: string;            // canonical URLs, sitemap, security.txt.
                                      // Production validation: HTTPS scheme, no trailing
                                      // path/slash, non-placeholder host.
  // Domains the site used to be served from. Not read by the app: the deploy
  // runbook lists the 301s that must be configured at the host, since the
  // production edge has no repo-committed config (see esa-headers.md).
  legacyOrigins: readonly string[];
  productName: string;                // from APP_NAME (never hardcoded here)

  operatorDisplayName: string;        // 'PetitMaker Team / 谷地工坊团队' (public-facing label).
                                      // The `{operator}` token in the document bodies and the
                                      // static page © line resolve from here. Written as
                                      // 'EN / ZH'; the registry splits on ' / ' to pick the
                                      // language-appropriate half.
  privacyContactEmail: string;        // selka.craft@outlook.com
  securityContactEmail: string;       // selka.craft@outlook.com

  icpNumber: string | null;           // e.g. '京ICP备2026xxxxxx号-1'
  icpUrl: string | null;              // https://beian.miit.gov.cn/
  psbNumber: string | null;           // e.g. '京公网安备 1101xxxxxxxxx号'
  psbUrl: string | null;              // PSB filing detail URL

  effectiveDates: {                   // rendered into the docs; changing a doc's substance
    privacy: string;                  // requires bumping date AND version (checklist item)
    terms: string;
  };
  policyVersions: {                   // human-visible policy version identifiers so it is
    privacy: string;                  // always determinable WHICH policy a user saw
    terms: string;                    // (rendered beside the effective date on page + modal)
  };

  // Roster shown on the About screen and rendered into the About doc — names +
  // Bilibili links only (no role labels). `avatar` is the
  // member's Bilibili MID (the numeric id in space.bilibili.com/<mid>); it is
  // an OPAQUE id here so config stays pure data — src/legal/team-avatars.ts
  // maps it to a bundled, hashed avatar asset URL that the About modal
  // resolves at render (an unmapped MID renders no image). The About DOC's
  // {team} table ignores it (the markdown renderer has no images by design).
  // `sort` is the name ROMANIZED (pinyin for Han, the name itself for Latin) and
  // is the only thing the roster is ordered by. A locale collator cannot do this:
  // ICU's zh ordering sorts Han by pinyin but places Latin script AFTER all of it
  // (so a reader sees H, J, Y, then S), and en collation orders Han by code point,
  // which is not alphabetical at all. Keep it lowercase, letters only.
  team: ReadonlyArray<{ name: string; sort: string; url: string; avatar?: string }>;
  repoUrl: string;                    // the PUBLIC repo URL surfaced in the UI
};

/**
 * Current values (2026-07-15). `npm run legal:validate` checks them against
 * `validate-config.ts`; `repoUrl` is not validated.
 */
export const LEGAL: LegalConfig = {
  canonicalOrigin: 'https://petit-maker.com',
  legacyOrigins: [],
  productName: APP_NAME,

  operatorDisplayName: 'PetitMaker Team / 谷地工坊团队',
  privacyContactEmail: 'selka.craft@outlook.com',
  securityContactEmail: 'selka.craft@outlook.com',

  icpNumber: null,
  icpUrl: null,
  psbNumber: null,
  psbUrl: null,

  effectiveDates: {
    privacy: '2026-07-30',
    terms: '2026-07-15',
  },
  policyVersions: {
    privacy: '1.1',
    terms: '1.0',
  },

  // Unordered data: every surface sorts it into the reader's alphabetical order
  // (registry.teamInReadingOrder), so this array's order is never what anyone sees.
  team: [
    { name: '镜喵MirrorCat', sort: 'jingmiaomirrorcat', url: 'https://space.bilibili.com/25599535', avatar: '25599535' },
    { name: '鱼松吃点吗', sort: 'yusongchidianma', url: 'https://space.bilibili.com/3632319829116985', avatar: '3632319829116985' },
    { name: '火山野牛王', sort: 'huoshanyeniuwang', url: 'https://space.bilibili.com/16699168', avatar: '16699168' },
    { name: 'Selka', sort: 'selka', url: 'https://space.bilibili.com/3546659724200757', avatar: '3546659724200757' },
  ],
  repoUrl: 'https://github.com/Stry233/PetitMaker',
};
