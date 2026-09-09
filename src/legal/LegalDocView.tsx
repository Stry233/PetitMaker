/**
 * View B of the About modal: an in-modal reader for one legal/policy document.
 *
 * Lazily imported by `AboutModal` (`React.lazy`) so the legal chunk — the doc
 * registry with every `?raw` markdown body, the markdown parser, and the
 * emitter — stays out of the main bundle until a user actually drills into a
 * doc. The `lang` attribute sits on the scrolling body container, so it covers
 * the whole prose fragment.
 *
 * Espresso-on-cream tokens from `ui/design/styles`: no invented colors, radii, or
 * shadows, and no CSS transform on a Framer-positioned element.
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../i18n/context';
import { useEditorStore } from '../state/store';
import { colors, font, radii, buttonMotion, cursors } from '../ui/design/styles';
import { skin } from '../ui/design/window-skin';
import { useChromeScale, useDevicePixelRatio, useReadableWeight } from '../ui/design/scale';
import { isDenseScript, roleFont, TEXT_ROLES, weightVars } from '../ui/design/text-weight';
import { SegmentedControl } from '../ui/primitives/SegmentedControl';
import { useScrollFade } from '../ui/primitives/scroll-fade';
import { DOCS, docNodes, type DocId } from './registry';
import { LEGAL } from './config';
import { LegalMarkdown } from './LegalMarkdown';

export interface LegalDocViewProps {
  id: DocId;
  lang: 'en' | 'zh';
  onLang: (l: 'en' | 'zh') => void;
  onBack: () => void;
  /** Optional: intercept an in-body cross-doc link (a root-relative slug path
   *  like `/privacy` or `/zh/terms`) so the reader switches docs in place
   *  instead of full-page navigating out of the SPA. */
  onInternalLink?: (slugPath: string) => void;
}

const container: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
};

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '18px 22px',
  borderBottom: `1px solid ${skin.line}`,
  flexShrink: 0,
};

const backBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  flexShrink: 0,
  border: 'none',
  cursor: cursors.clickable,
  borderRadius: radii.pill,
  background: skin.inset,
  color: skin.ink,
};

const titleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 18,
  color: skin.ink,
  fontFamily: font.family,
  lineHeight: 1.2,
  outline: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const headerControls: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexShrink: 0,
};

const bodyScroll: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '20px 28px 24px',
};

// `colors.textSecondary` fails WCAG AA (~3.5-3.9:1) at this size against both the card plate (the
// footer's background) and `skin.inset` (the en-only note's background) — `colors.brownText` is the
// darkest existing muted/taupe token and clears 4.5:1 against both (see
// src/__tests__/legal/a11y.test.tsx's contrast describe block).
const enOnlyNote: CSSProperties = {
  margin: '0 0 16px',
  padding: '10px 14px',
  borderRadius: radii.md,
  background: skin.inset,
  color: colors.brownText,
  ...roleFont('note'),
  fontFamily: font.family,
  lineHeight: 1.5,
};

const footerBar: CSSProperties = {
  flexShrink: 0,
  padding: '12px 28px',
  borderTop: `1px solid ${skin.line}`,
  ...roleFont('caption'),
  color: colors.brownText,
  fontFamily: font.family,
};

export default function LegalDocView({ id, lang, onLang, onBack, onInternalLink }: LegalDocViewProps) {
  const t = useT();
  const weightAt = useReadableWeight();
  const zoom = useChromeScale();
  const dpr = useDevicePixelRatio();
  const uiLocale = useEditorStore((s) => s.locale);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // No `dep` needed for the doc/lang swap: the hook re-checks the element every render, and a doc
  // swap re-renders this same body element with new content.
  const bodyFade = useScrollFade(bodyRef, 'y');

  const meta = DOCS[id];
  const hasZh = meta.source.zh !== null;
  // en-only docs always render English; the shared modal `lang` state may be 'zh'.
  const effLang: 'en' | 'zh' = hasZh ? lang : 'en';
  // `docNodes` (not the raw parser) so a doc whose source carries no markdown
  // heading at all (LICENSE — pinned byte-exact) still gets a synthetic h1
  // for the accessibility heading-hierarchy contract.
  const nodes = docNodes(id, effLang, LEGAL, t(meta.titleKey));

  const dated = meta.schema.requiresEffectiveDate;
  const effectiveDate = (LEGAL.effectiveDates as Record<string, string>)[id] ?? '';
  const policyVersion = (LEGAL.policyVersions as Record<string, string>)[id] ?? '';

  // Move focus to the doc title on open (and whenever the doc changes) so screen
  // readers land on the new view rather than the stale grid position.
  useEffect(() => {
    titleRef.current?.focus();
  }, [id]);

  return (
    <div style={container}>
      <header style={headerRow}>
        <motion.button
          type="button"
          onClick={onBack}
          aria-label={t('legal.back')}
          style={backBtn}
          {...buttonMotion}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M10 3 L5 8 L10 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.button>

        <h2 ref={titleRef} tabIndex={-1} style={{ ...titleStyle, fontWeight: weightAt(800, titleStyle.fontSize as number) }}>
          {t(meta.titleKey)}
        </h2>

        <div style={headerControls}>
          {hasZh && (
            <div role="group" aria-label={t('legal.lang_toggle_label')} style={{ display: 'flex' }}>
              <SegmentedControl
                idPrefix="legal-lang"
                value={lang}
                options={['zh', 'en'] as const}
                onChange={onLang}
                render={(o) => (o === 'zh' ? '中文' : 'English')}
                stretch={false}
              />
            </div>
          )}
        </div>
      </header>

      <div
        ref={bodyRef}
        data-testid="legal-doc-body"
        data-scroll
        lang={effLang === 'zh' ? 'zh-CN' : 'en'}
        style={{ ...bodyScroll, ...bodyFade, ...weightVars(zoom, dpr, isDenseScript(effLang)) }}
      >
        {!hasZh && uiLocale !== 'en' && (
          <div data-testid="en-only-note" lang={uiLocale} style={{ ...enOnlyNote, fontWeight: weightAt(TEXT_ROLES.note.weight, TEXT_ROLES.note.px) }}>
            {t('legal.zh_only_note')}
          </div>
        )}
        <LegalMarkdown nodes={nodes} onInternalLink={onInternalLink} dense={isDenseScript(effLang)} />
      </div>

      {dated && (
        <div style={footerBar}>
          {t('legal.updated', { date: effectiveDate, version: policyVersion })}
        </div>
      )}
    </div>
  );
}
