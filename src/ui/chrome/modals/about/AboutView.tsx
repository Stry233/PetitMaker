/**
 * The About view: the brand with the build line, the team and acknowledgement rosters, the document
 * grid About drills into, feedback, support, the filing numbers and the footer. Wide windows lay it
 * out as a brand band over two panes; narrow ones stack it in one column.
 */
import type { MutableRefObject } from 'react';
import { motion } from 'framer-motion';
import { useLocale, useT } from '../../../../i18n/context';
import { joinList } from '../../../../i18n/locale-info';
import { EDITION_COPY, SUPPORTS_CLIPBOARD, SUPPORTS_EXTERNAL_LINKS, inEdition } from '../../../../platform/build/edition';
import { APP_VERSION, BUILD_DATE, BUILD_NUMBER, BUILD_SHA, BUILD_YEAR } from '../../../../platform/build/build-info';
import { APP_NAME } from '../../../../i18n/terms/brand';
import { DOCS, qqChannelPageUrl, teamInReadingOrder, type DocId } from '../../../../legal/registry';
import { DocIcon } from './doc-icons';
import { LEGAL, memberUrl } from '../../../../legal/config';
import { teamAvatarUrl } from '../../../../legal/team-avatars';
import { cursors, interactionProfiles } from '../../../design/styles';
import { ActionButton } from '../../../primitives/ActionButton';
import { CopiedBubble, useCopyFeedback } from '../../../primitives/CopiedBubble';
import { BrandLockup } from '../../BrandLockup';
import {
  avatarBadge, avatarImg, avatarRing, bandRight, brandBand, brandBlock, chevron, disclaimerStyle, filingLabel, filingLink,
  filingRow, footerRow, gridIcon, gridLabel, gridRow, gridStyle, hairline, memberCard, memberName, pane, paneDivider, panes,
  repositoryLink, sectionLabel, teamGrid, teamNote, versionButton, versionButtonWrap, wideCard, wideGrid,
} from './about-styles';

/** The documents About drills into, in reading order; the offline edition carries the licences only. */
const DOC_ROWS: readonly { id: DocId; lite?: false }[] = [
  { id: 'privacy', lite: false },
  { id: 'terms', lite: false },
  { id: 'license' },
  { id: 'third-party' },
  { id: 'asset-licenses' },
  { id: 'security', lite: false },
  { id: 'contact', lite: false },
  { id: 'changelog', lite: false },
];
const GRID_DOCS: DocId[] = DOC_ROWS.filter(inEdition).map((row) => row.id);
/** Whether About may drill into `id`: in the offline edition, only a document it carries. */
export const opensDoc = (id: DocId): boolean => inEdition(DOC_ROWS.find((row) => row.id === id) ?? { lite: false });

const press = interactionProfiles.action;

export interface AboutViewProps {
  wide: boolean;
  onOpenDoc: (id: DocId) => void;
  /** Each document row, so Back can return focus to the row that opened the document. */
  rowRefs: MutableRefObject<Partial<Record<DocId, HTMLButtonElement | null>>>;
}

export function AboutView({ wide, onOpenDoc, rowRefs }: AboutViewProps) {
  const t = useT();
  const team = <Roster members={LEGAL.team} wide={wide} gridTestId="team-grid" cardTestId="team-member" />;
  const acknowledged = <Roster members={LEGAL.acknowledgements} wide={wide} gridTestId="acknowledgements-grid" cardTestId="acknowledged-member" />;
  const documents = (
    <>
      <LegalGrid onOpenDoc={onOpenDoc} rowRefs={rowRefs} />
      <Filing />
      <Feedback />
      <Support />
    </>
  );
  if (wide) {
    return (
      <>
        <div style={brandBand} data-testid="about-band">
          <BrandLockup size={60} tagline />
          <div style={bandRight}><VersionRow wide /></div>
        </div>
        <div style={hairline} />
        <div style={panes}>
          <div style={{ ...pane, gap: 12 }} data-testid="about-people">
            <div><div style={sectionLabel}>{t('about.team_title')}</div>{team}</div>
            <div><div style={sectionLabel}>{t('about.acknowledgements_title')}</div>{acknowledged}</div>
            <div style={{ ...teamNote, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
              {EDITION_COPY.teamOrder && <span>{t(EDITION_COPY.teamOrder)}</span>}
              <span>{t('about.acknowledgements_note')}</span>
            </div>
          </div>
          <div style={paneDivider} data-testid="about-documents">{documents}</div>
        </div>
        <Footer />
      </>
    );
  }
  return (
    <>
      <div style={brandBlock}>
        <BrandLockup size={72} tagline />
        <VersionRow wide={false} />
      </div>
      <div>
        <div style={sectionLabel}>{t('about.team_title')}</div>
        {EDITION_COPY.teamOrder && <div style={teamNote}>{t(EDITION_COPY.teamOrder)}</div>}
        {team}
      </div>
      <div>
        <div style={sectionLabel}>{t('about.acknowledgements_title')}</div>
        <div style={teamNote}>{t('about.acknowledgements_note')}</div>
        {acknowledged}
      </div>
      {documents}
      <Footer />
    </>
  );
}

/** The version line, which copies the build and the browser for a report, and the source link. */
function VersionRow({ wide }: { wide: boolean }) {
  const t = useT();
  const { copied, copy } = useCopyFeedback<'build'>();
  const locale = useLocale();
  const versionText = joinList(locale, [
    t('about.version_number', { version: APP_VERSION }), t('about.build_number', { build: BUILD_NUMBER }), BUILD_SHA, BUILD_DATE,
  ].filter(Boolean), { conjunction: false });
  const align = wide ? { textAlign: 'right' as const } : {};
  return (
    <>
      <div style={versionButtonWrap}>
        {SUPPORTS_CLIPBOARD ? (
          <>
            <ActionButton interaction="quietLink" style={{ ...versionButton, ...align }} aria-label={t('about.copy_build')}
              onClick={() => copy(`${APP_NAME} ${APP_VERSION} (build ${BUILD_NUMBER}, ${BUILD_SHA}, ${BUILD_DATE})\n${navigator.userAgent}`, 'build')}>
              {versionText}
            </ActionButton>
            <CopiedBubble show={copied === 'build'} side="above">{t('about.copied')}</CopiedBubble>
          </>
        ) : (
          <div style={{ ...versionButton, cursor: cursors.text, userSelect: 'text', WebkitUserSelect: 'text', ...align }}>{versionText}</div>
        )}
      </div>
      {SUPPORTS_EXTERNAL_LINKS && (
        <motion.a style={repositoryLink} href={LEGAL.repoUrl} target="_blank" rel="noopener noreferrer" {...press}>
          {t('about.repository_link')} <span aria-hidden>↗</span>
        </motion.a>
      )}
    </>
  );
}

function Roster({ members, wide, gridTestId, cardTestId }: { members: typeof LEGAL.team; wide: boolean; gridTestId: string; cardTestId: string }) {
  const t = useT();
  const Member = SUPPORTS_EXTERNAL_LINKS ? motion.a : motion.div;
  return (
    <div style={wide ? wideGrid : teamGrid} data-testid={gridTestId}>
      {teamInReadingOrder(members).map((m) => {
        const avatar = teamAvatarUrl(m.bilibili);
        return (
          <Member
            key={m.bilibili}
            data-testid={cardTestId}
            style={{ ...(wide ? wideCard : memberCard), ...(!SUPPORTS_EXTERNAL_LINKS ? { cursor: cursors.default } : {}) }}
            {...(!SUPPORTS_EXTERNAL_LINKS ? {} : { href: memberUrl(m), target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('about.team_link', { name: m.name }), ...press })}
         >
            <span style={avatarRing}>
              {avatar && <img src={avatar} alt={m.name} style={avatarImg} />}
              {SUPPORTS_EXTERNAL_LINKS && <span style={avatarBadge} aria-hidden>↗</span>}
            </span>
            <span style={memberName}>{m.name}</span>
          </Member>
        );
      })}
    </div>
  );
}

function LegalGrid({ onOpenDoc, rowRefs }: Pick<AboutViewProps, 'onOpenDoc' | 'rowRefs'>) {
  const t = useT();
  return (
    <div>
      <div style={sectionLabel}>{t('legal.section_title')}</div>
      <div style={gridStyle} data-testid="legal-grid">
        {GRID_DOCS.map((id) => (
          <ActionButton key={id} data-testid={`legal-row-${id}`} ref={(el) => { rowRefs.current[id] = el; }} style={gridRow} onClick={() => onOpenDoc(id)}>
            <span style={gridIcon}><DocIcon id={id} size={16} /></span>
            <span style={gridLabel}>{t(DOCS[id].titleKey)}</span>
            <span style={chevron} aria-hidden>›</span>
          </ActionButton>
        ))}
      </div>
    </div>
  );
}

function Feedback() {
  const t = useT();
  if (!SUPPORTS_EXTERNAL_LINKS) {
    return (
      <div data-testid="feedback-links">
        <div style={sectionLabel}>{t('about.feedback_title')}</div>
        <div style={{ ...gridRow, cursor: cursors.text, userSelect: 'text', WebkitUserSelect: 'text' }}>
          <span style={{ ...gridLabel, overflowWrap: 'break-word' }}>{LEGAL.privacyContactEmail}</span>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="feedback-links">
      <div style={sectionLabel}>{t('about.feedback_title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <motion.a href={qqChannelPageUrl(LEGAL.qqFeedbackChannel)} target="_blank" rel="noopener noreferrer" style={gridRow} data-testid="qq-feedback-channel" {...press}>
          <span style={{ ...gridLabel, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>{t('about.qq_channel_name')}</span>
            <span style={{ ...teamNote, margin: 0 }}>{t('about.qq_channel_number', { number: LEGAL.qqFeedbackChannel })}</span>
          </span>
          <span style={chevron} aria-hidden>↗</span>
        </motion.a>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }} data-testid="report-links">
          <motion.a href={`${LEGAL.repoUrl}/issues`} target="_blank" rel="noopener noreferrer" style={gridRow} {...press}>
            <span style={gridLabel}>{t('about.github_issues')}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
          <motion.a href={`mailto:${LEGAL.privacyContactEmail}`} style={gridRow} {...press}>
            <span style={gridLabel}>{t('about.email_feedback')}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
        </div>
      </div>
    </div>
  );
}

function Support() {
  const t = useT();
  if (!SUPPORTS_EXTERNAL_LINKS) return null;
  return (
    <div>
      <div style={sectionLabel}>{t('about.sponsorship_title')}</div>
      <div style={gridStyle} data-testid="sponsorship-links">
        {([
          { href: LEGAL.sponsorship.patreon, key: 'about.patreon' },
          { href: LEGAL.sponsorship.afdian, key: 'about.afdian' },
        ] as const).map(({ href, key }) => (
          <motion.a key={key} href={href} target="_blank" rel="noopener noreferrer" style={gridRow} {...press}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 20 4.5 12.5a5 5 0 0 1 7.5-6.6 5 5 0 0 1 7.5 6.6L12 20Z" />
            </svg>
            <span style={gridLabel}>{t(key)}</span>
            <span style={chevron} aria-hidden>↗</span>
          </motion.a>
        ))}
      </div>
    </div>
  );
}

/** Only a complete number and address pair renders. */
function Filing() {
  const t = useT();
  const hasIcp = !!(LEGAL.icpNumber && LEGAL.icpUrl);
  const hasPsb = !!(LEGAL.psbNumber && LEGAL.psbUrl);
  if (!SUPPORTS_EXTERNAL_LINKS || !(hasIcp || hasPsb)) return null;
  return (
    <div>
      {hasIcp && (
        <div style={filingRow} data-testid="filing-icp">
          <span style={filingLabel}>{t('about.filing_icp')}</span>
          <a style={filingLink} href={LEGAL.icpUrl!} target="_blank" rel="noopener noreferrer">{LEGAL.icpNumber} ↗</a>
        </div>
      )}
      {hasPsb && (
        <div style={filingRow} data-testid="filing-psb">
          <span style={filingLabel}>{t('about.filing_psb')}</span>
          <a style={filingLink} href={LEGAL.psbUrl!} target="_blank" rel="noopener noreferrer">{LEGAL.psbNumber} ↗</a>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const t = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={disclaimerStyle}>{t('about.disclaimer')}</div>
      <div style={footerRow}><span>{t('about.copyright', { year: BUILD_YEAR })}</span></div>
    </div>
  );
}
