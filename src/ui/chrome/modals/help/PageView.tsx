/*
 * PageView.tsx — one help page rendered from its descriptor.
 *
 * Everything textual arrives as an i18n key and is resolved with the live fact params
 * (`facts.ts`), so a page never holds a number the source already declares. Key tables resolve
 * their command ids through the live keymap (`resolveTokenSpecs`), which is what keeps a rebind
 * and its documentation the same fact.
 */
import { Fragment, memo, useId, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useEditorStore } from '../../../../state/store';
import { startTour } from '../../tour/use-tour';
import { useT } from '../../../../i18n/context';
import { useKeybinds } from '../../../../core/runtime/keybindings';
import { resolveTokenSpecs } from '../../../hints/catalogue';
import { HintTokens } from '../../../hints/tokens';
import { roleFont } from '../../../design/text-weight';
import { INK, INSET, LINE, PLATE_INK } from '../../../design/tokens';
import { buttonMotion, colors, cursors, primaryButton, radii, springs } from '../../../design/styles';
import { withAlpha } from '../../../design/styles';
import { Expand } from '../../../primitives/Expand';
import { BrandLockup } from '../../BrandLockup';
import { LoadDiscSvg } from '../../../shell/windows/LoadMeter';
import { inlineArt, type InlineArt } from './inline-art';
import { helpFacts } from './facts';
import { HELP_SCENES } from './figures/scenes';
import { HelpDemo } from './figures/HelpDemo';
import { HELP_SURFACES } from './figures/surfaces';
import type { HelpPage, HelpPageId, HelpSection } from './page-schema';
import { HELP_GROUP_TITLES, HELP_PAGES } from './catalog';

/** One box for every inline art: the same height and baseline whatever the kind, so a sentence's
 *  icons sit level with each other and with the text. */
const ART_H = '1.15em';
const ART_VA = '-0.22em';
/** The same air on BOTH sides of an inline icon, so one jammed against the character before it
 *  and spaced from the one after does not read as a typo. */
const ART_MARGIN = '0 0.15em';

/** A composed control drawn inline: the owner's own layered parts, scaled to text height. */
function InlineGlyph({ glyph, flip }: { glyph: NonNullable<Extract<InlineArt, { kind: 'glyph' }>['glyph']>; flip?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', position: 'relative',
        height: ART_H, width: `${(1.15 * glyph.w) / glyph.h}em`,
        verticalAlign: ART_VA, margin: ART_MARGIN,
        transform: flip ? 'scaleX(-1)' : undefined,
      }}
    >
      {glyph.parts.map((p, i) => (
        <img
          key={i}
          src={p.src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${(p.x / glyph.w) * 100}%`, top: `${(p.y / glyph.h) * 100}%`,
            width: `${(p.w / glyph.w) * 100}%`, height: `${(p.h / glyph.h) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}

/** The load meter's disc at text height, drawn by the meter's own SVG. */
function InlineDisc() {
  const id = useId().replace(/:/g, '');
  return (
    <span aria-hidden style={{ display: 'inline-block', height: ART_H, width: ART_H, verticalAlign: ART_VA, margin: ART_MARGIN }}>
      <LoadDiscSvg fill={0.66} maskId={`inline-load-${id}`} style={{ width: '100%', height: '100%', display: 'block' }} />
    </span>
  );
}

/** `[[name]]` in a body string becomes the named art, inline at text height — the icon the words
 *  are pointing at (a mode block, a rail button, a tool cell), so the reader can find it on
 *  screen by its face. */
function inlineIcons(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/\[\[([a-z0-9-]+)\]\]/g);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>;
    const art = inlineArt(part);
    if (!art) return <Fragment key={`${keyBase}-${i}`} />;
    if (art.kind === 'glyph') return <InlineGlyph key={`${keyBase}-${i}`} glyph={art.glyph} flip={art.flip} />;
    if (art.kind === 'disc') return <InlineDisc key={`${keyBase}-${i}`} />;
    const image = (
      <img
        src={art.src}
        alt=""
        draggable={false}
        style={{ height: art.plate ? '1em' : ART_H, verticalAlign: art.plate ? undefined : ART_VA, display: art.plate ? 'block' : 'inline' }}
      />
    );
    // Cream art on the cream page needs a soft backing to read as a control at all.
    return art.plate ? (
      <span
        key={`${keyBase}-${i}`}
        aria-hidden
        style={{
          display: 'inline-block', background: 'rgba(74,59,50,0.14)', borderRadius: '0.3em',
          padding: '0.075em 0.12em', lineHeight: 0, margin: ART_MARGIN, verticalAlign: ART_VA,
        }}
      >
        {image}
      </span>
    ) : (
      <span key={`${keyBase}-${i}`} style={{ margin: ART_MARGIN }}>{image}</span>
    );
  });
}

/** `**bold**` in a body string becomes the ink weight; `[[name]]` becomes the named art. */
function emphasize(text: string): ReactNode {
  const parts = text.split('**');
  return parts.map((part, i) => (i % 2 === 1
    ? <b key={i} style={{ fontWeight: 800, color: INK }}>{inlineIcons(part, `b${i}`)}</b>
    : <Fragment key={i}>{inlineIcons(part, `t${i}`)}</Fragment>));
}

function SectionView({ section }: { section: HelpSection }) {
  const t = useT();
  const overrides = useKeybinds((s) => s.overrides);
  const facts = helpFacts(useEditorStore((s) => s.locale));
  if (section.kind === 'callout') {
    return (
      <div style={{ background: 'rgba(255,218,126,0.28)', borderRadius: radii.md, padding: '12px 16px', marginTop: 14 }}>
        <p style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.7, margin: 0 }}>{emphasize(t(section.bodyKey, facts))}</p>
      </div>
    );
  }
  const heading = (
    <h3 id={`help-${section.anchor}`} style={{ ...roleFont('lead'), color: INK, margin: '28px 0 8px', scrollMarginTop: 16 }}>
      {t(section.titleKey, facts)}
    </h3>
  );
  if (section.kind === 'keys') {
    return (
      <section>
        {heading}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
          {section.rows.map((row) => {
            const tokens = resolveTokenSpecs(row.tokens, overrides);
            if (!tokens) return null;
            return (
              <div key={row.doKey} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ ...roleFont('reading'), color: PLATE_INK, marginRight: 'auto' }}>{t(row.doKey, facts)}</span>
                <HintTokens tokens={tokens} />
              </div>
            );
          })}
        </div>
        {section.afterKeys?.map((key) => (
          <p key={key} style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.75, marginTop: 8 }}>{emphasize(t(key, facts))}</p>
        ))}
      </section>
    );
  }
  return (
    <section>
      {heading}
      {section.bodyKeys.map((key) => (
        <p key={key} style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.75, marginTop: 6 }}>{emphasize(t(key, facts))}</p>
      ))}
      {section.figure && <Figure fig={section.figure} />}
    </section>
  );
}

function Figure({ fig }: { fig: HelpPage['figure'] }) {
  const t = useT();
  const facts = helpFacts(useEditorStore((s) => s.locale));
  if (!fig) return null;
  let body: ReactNode = null;
  if (fig.kind === 'demo') {
    const scene = HELP_SCENES[fig.scene];
    body = scene ? <HelpDemo scene={scene} /> : null;
  } else if (fig.kind === 'demos') {
    body = (
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        {fig.scenes.map(({ scene, labelKey }) => {
          const sc = HELP_SCENES[scene];
          return sc ? (
            <div key={scene} style={{ background: colors.panelCream, borderRadius: 14, padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <HelpDemo scene={sc} />
              <span style={{ ...roleFont('note'), color: PLATE_INK }}>{t(labelKey, facts)}</span>
            </div>
          ) : null;
        })}
      </div>
    );
  } else {
    const Mock = HELP_SURFACES[fig.surface];
    body = Mock ? <Mock /> : null;
  }
  if (!body) return null;
  // A demo narrates itself with its animated caption; only a surface carries a static one.
  return (
    <figure style={{ background: withAlpha(INSET, 0.42), borderRadius: 18, padding: '18px 18px 12px', margin: '16px 0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, overflowX: 'auto' }}>
      {body}
      {fig.kind === 'surface' && (
        <figcaption style={{ ...roleFont('note'), color: colors.brownText, textAlign: 'center', lineHeight: 1.5, paddingBottom: 4 }}>
          {t(fig.captionKey, facts)}
        </figcaption>
      )}
    </figure>
  );
}

/** One Q&A disclosure row: the question is a plain full-width row (a scale-based press would spill
 *  past the card's own `overflow: hidden` rounded corners), the answer's height and the chevron's
 *  turn both animate, and `Expand` folds in the reduced-motion instant snap already. */
function QaRow({ qKey, aKey, facts, t }: { qKey: string; aKey: string; facts: ReturnType<typeof helpFacts>; t: ReturnType<typeof useT> }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: withAlpha(INSET, 0.42), borderRadius: 14, overflow: 'hidden' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          // The question ranks its own 16px answer the way `head` ranks `reading`: same size,
          // weight apart, so an opened row does not read larger than the question it answers.
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none',
          background: 'none', textAlign: 'left', ...roleFont('head'), color: INK,
          padding: '12px 16px', cursor: cursors.clickable, transition: 'background-color 0.15s ease',
        }}
        onPointerEnter={(e) => { e.currentTarget.style.background = withAlpha(INSET, 0.9); }}
        onPointerLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      >
        <span style={{ flex: 1 }}>{t(qKey, facts)}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={springs.stiff}
          style={{ fontSize: 16, fontWeight: 700, color: colors.brownText, flexShrink: 0 }}
        >
          ›
        </motion.span>
      </button>
      <Expand open={open}>
        <p style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.7, padding: '0 16px 14px', margin: 0 }}>
          {emphasize(t(aKey, facts))}
        </p>
      </Expand>
    </div>
  );
}

function ActionButton({ action }: { action: NonNullable<HelpPage['action']> }) {
  const t = useT();
  const setModal = useEditorStore((s) => s.setModal);
  const run = () => {
    // Either action opens something the help window would otherwise stand in front of, so the
    // help steps aside first; it keeps the reader's place for the way back.
    setModal('help', false);
    if (action.kind === 'open-keyboard') { setModal('keyboard', true); return; }
    startTour();
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
      <motion.button type="button" {...buttonMotion} onClick={run} style={{ ...primaryButton }}>
        {t(action.labelKey)}
      </motion.button>
    </div>
  );
}

/** Memoized on its props: the window re-renders on every search keystroke, and an unchanged page
 *  standing behind the dropdown can hold a dozen live demo figures — locale and keymap changes
 *  still arrive through the hooks' own subscriptions. */
export const PageView = memo(function PageView({ page, onGo }: { page: HelpPage; onGo: (id: HelpPageId, anchor?: string) => void }) {
  const t = useT();
  const facts = helpFacts(useEditorStore((s) => s.locale));
  return (
    <article style={{ padding: '26px 34px 40px', maxWidth: 730 }}>
      {page.hero ? (
        <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, margin: '6px 0 4px' }}>
          <BrandLockup size={64} logoOnly />
          <h2 style={{ ...roleFont('title'), color: INK, lineHeight: 1.35, margin: 0 }}>{t(page.titleKey, facts)}</h2>
          <p style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.65, margin: 0, maxWidth: 560 }}>{emphasize(t(page.ledeKey, facts))}</p>
        </header>
      ) : (
        <>
          <div style={{ ...roleFont('note'), color: colors.brownText, marginBottom: 6 }}>{t(HELP_GROUP_TITLES[page.group])}</div>
          <h2 style={{ ...roleFont('title'), color: INK, lineHeight: 1.35, margin: 0 }}>{t(page.titleKey)}</h2>
          <p style={{ ...roleFont('reading'), color: PLATE_INK, lineHeight: 1.65, marginTop: 8 }}>{emphasize(t(page.ledeKey, facts))}</p>
        </>
      )}
      <Figure fig={page.figure} />
      {page.action && <ActionButton action={page.action} />}
      {page.sections.map((section, i) => <SectionView key={i} section={section} />)}
      {page.qa.length > 0 && (
        <>
          <h3 style={{ ...roleFont('lead'), color: INK, margin: '28px 0 8px' }}>{t('help.qa_title')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {page.qa.map((qa) => (
              <QaRow key={qa.qKey} qKey={qa.qKey} aKey={qa.aKey} facts={facts} t={t} />
            ))}
          </div>
        </>
      )}
      {page.seeAlso.length > 0 && (
        <>
          <h3 style={{ ...roleFont('lead'), color: INK, margin: '28px 0 8px' }}>{t('help.see_also')}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {page.seeAlso.map((id) => (
              <motion.button
                key={id}
                type="button"
                onClick={() => onGo(id)}
                {...buttonMotion}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none',
                  background: INSET, color: PLATE_INK, borderRadius: radii.pill,
                  padding: '7px 14px', ...roleFont('chip'), cursor: cursors.clickable,
                  transition: 'background-color 0.15s ease',
                }}
                onPointerEnter={(e) => { e.currentTarget.style.background = colors.tileYellow; }}
                onPointerLeave={(e) => { e.currentTarget.style.background = INSET; }}
              >
                {t(HELP_PAGES[id].titleKey)}
              </motion.button>
            ))}
          </div>
        </>
      )}
      <span aria-hidden style={{ display: 'block', height: 2, background: LINE, opacity: 0, marginTop: 8 }} />
    </article>
  );
});
