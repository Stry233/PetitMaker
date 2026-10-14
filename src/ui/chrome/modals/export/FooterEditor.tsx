// DaVinci-style footer builder: a single editable line where you type plain text freely and insert
// token "bubbles" that behave as one atomic character (Backspace deletes the whole chip). Tags are
// inserted from a menu opened by the "+ Insert tag" button or by typing "/"; while the menu
// is open ↑/↓ move the highlight and Enter inserts. Zero-width-space slots are kept around chips so
// the caret can sit between adjacent tags (and you can type there) even with no plain text between
// them. {fill} splits the footer into a left- and a right-aligned half.
import { useRef, useLayoutEffect, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { font, radii, cursors } from '../../../design/styles';
import { TILE_MODE_GREEN } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont, roleWeight, TEXT_ROLES } from '../../../design/text-weight';
import { ActionButton } from '../../../primitives/ActionButton';
import { FloatMenu } from '../../../primitives/FloatMenu';
import { FOOTER_TOKENS, FOOTER_FILL, parseFooter } from '../../../../io/export/facts';
import { ReviewIndicator } from './review/ReviewIndicator';
import type { Translate } from '../../../../i18n/keys';

const MENU_W = 250;
const ZW = '\u200B'; // zero-width space: an invisible, editable caret slot placed around chips

/** Menu order = the token list, then Fill last. */
const MENU_IDS = [...FOOTER_TOKENS.map((tk) => tk.id), FOOTER_FILL];

export function FooterEditor({ value, onChange, samples, t, checking = false, refused = false, reviewLabel = '' }: {
  value: string;
  onChange: (template: string) => void;
  /** Current value of each token id (date/dims/name/…) shown in the menu as a reference. */
  samples: Record<string, string>;
  t: Translate;
  checking?: boolean;
  refused?: boolean;
  reviewLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const lastSerialized = useRef('');
  /** The open tag menu, and whether a typed "/" opened it (the slash goes when a tag is chosen). */
  const [menu, setMenu] = useState<{ fromSlash: boolean } | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);

  const labelFor = (id: string) => (id === FOOTER_FILL ? t('export.footer_fill') : (FOOTER_TOKENS.find((tk) => tk.id === id) ? t(FOOTER_TOKENS.find((tk) => tk.id === id)!.labelKey) : id));

  const makeChip = (id: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.dataset.tok = id;
    span.contentEditable = 'false';
    span.className = id === FOOTER_FILL ? 'ppfe-chip ppfe-fill' : 'ppfe-chip';
    span.textContent = id === FOOTER_FILL ? `⇥ ${labelFor(id)}` : labelFor(id);
    return span;
  };

  // Rebuild the editable DOM only on external value changes (not our own edits) so the caret is kept.
  // Built with safe DOM node APIs (no innerHTML); a ZW text node sits before each chip (and after a
  // trailing chip) so the caret always has a place to land between tags.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === lastSerialized.current) return;
    const segs = parseFooter(value);
    const nodes: Node[] = [];
    segs.forEach((s) => {
      if (s.t === 'token') { nodes.push(document.createTextNode(ZW)); nodes.push(makeChip(s.id)); }
      else nodes.push(document.createTextNode(s.v));
    });
    if (segs.length && segs[segs.length - 1]!.t === 'token') nodes.push(document.createTextNode(ZW));
    el.replaceChildren(...nodes);
    lastSerialized.current = value;
  }); // Runs after every render; the lastSerialized check stops repeats.

  const serialize = (el: HTMLElement): string => {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) out += (node.nodeValue ?? '').replace(/[{}\u200B]/g, '');
      else if (node instanceof HTMLElement) {
        const tok = node.dataset.tok;
        if (tok) out += `{${tok}}`;
        else if (node.tagName !== 'BR') out += node.textContent?.replace(/[{}\u200B]/g, '') ?? '';
      }
    });
    return out;
  };

  const sync = () => {
    const el = ref.current; if (!el) return;
    const s = serialize(el);
    lastSerialized.current = s;
    onChange(s);
  };

  const openMenu = (a: { fromSlash: boolean }) => { setMenu(a); setMenuIndex(0); };

  const onInput = () => {
    sync();
    // Typing "/" opens the tag menu at the caret (the "/" is removed when a tag is chosen).
    const sel = window.getSelection();
    const node = sel?.focusNode;
    if (sel?.isCollapsed && node?.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').slice(0, sel.focusOffset).endsWith('/')) {
      openMenu({ fromSlash: true });
    } else if (menu?.fromSlash) {
      setMenu(null);
    }
  };

  // Plain text only: the clipboard's own markup never becomes part of the editable line.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!inserted) {
      const node = document.createTextNode(text);
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (range && ref.current?.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node); range.collapse(true);
        sel!.removeAllRanges(); sel!.addRange(range);
      } else {
        ref.current?.append(node);
      }
    }
    onInput();
  };

  const insertToken = (id: string, fromSlash: boolean) => {
    const el = ref.current; if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { el.append(document.createTextNode(ZW), makeChip(id), document.createTextNode(ZW)); sync(); setMenu(null); return; }
    const range = sel.getRangeAt(0);
    // Remove the trigger "/" sitting just before the caret.
    if (fromSlash && range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      const txt = range.startContainer as Text;
      if (txt.nodeValue?.[range.startOffset - 1] === '/') txt.deleteData(range.startOffset - 1, 1);
    }
    const chip = makeChip(id);
    range.insertNode(chip);
    // Caret slots on both sides so you can keep typing/navigating around the new chip.
    if (!chip.previousSibling || chip.previousSibling.nodeType !== Node.TEXT_NODE) chip.before(document.createTextNode(ZW));
    const after = document.createTextNode(ZW);
    chip.after(after);
    range.setStartAfter(after); range.collapse(true);
    sel.removeAllRanges(); sel.addRange(range);
    sync();
    setMenu(null);
  };

  // While the menu is open, the field or the Insert button keeps focus: ↑/↓ move the highlight
  // and Enter inserts; Escape reaches the menu's own surface, which closes it alone.
  const onMenuKeys = (e: React.KeyboardEvent) => {
    if (!menu) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setMenuIndex((i) => (i + 1) % MENU_IDS.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setMenuIndex((i) => (i - 1 + MENU_IDS.length) % MENU_IDS.length); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); insertToken(MENU_IDS[menuIndex]!, menu.fromSlash); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <style>{`
        .ppfe-field .ppfe-chip{display:inline-flex;align-items:center;line-height:1;background:${skin.active};color:${skin.ink};border-radius:999px;padding:5px 9px;margin:0 1px;font-weight:${roleWeight('small')};font-size:${TEXT_ROLES.small.px}px;white-space:nowrap;user-select:none;}
        .ppfe-field .ppfe-fill{background:${TILE_MODE_GREEN};}
        .ppfe-field:empty:before{content:attr(data-ph);color:${skin.muted};}
      `}</style>
      <div ref={rowRef} onKeyDownCapture={onMenuKeys} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <div
          ref={ref}
          className="ppfe-field"
          contentEditable
          role="textbox"
          aria-label={t('export.opt_footer')}
          aria-busy={checking}
          aria-invalid={refused}
          suppressContentEditableWarning
          data-ph={t('export.footer_ph')}
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); if (e.key === 'Enter' && !menu) e.preventDefault(); }}
          onBlur={sync}
          style={{ ...fieldStyle, paddingRight: 32 }}
        />
        {checking && <ReviewIndicator label={reviewLabel} />}
        </div>
        <ActionButton interaction="tile" onClick={() => (menu ? setMenu(null) : openMenu({ fromSlash: false }))} style={addBtn}>+ {t('export.footer_insert')}</ActionButton>
      </div>
      <div style={hintStyle}>{t('export.footer_slash_hint')}</div>

      <FloatMenu
        row={null}
        anchor={rowRef}
        width={MENU_W}
        keepFocus
        open={menu !== null}
        onOpen={() => openMenu({ fromSlash: false })}
        onClose={() => setMenu(null)}
        highlightId={MENU_IDS[menuIndex]}
        onPick={(id) => insertToken(id, menu?.fromSlash ?? false)}
        items={[
          ...FOOTER_TOKENS.map((tk) => ({ id: tk.id, label: t(tk.labelKey), sub: <span style={menuSample}>{samples[tk.id] || t('export.footer_na')}</span> })),
          { id: FOOTER_FILL, label: `⇥ ${t('export.footer_fill')}`, sub: <span style={menuSample}>{t('export.footer_fill_hint')}</span>, separated: true },
        ]}
        aria-label={t('export.footer_insert')}
      />
    </div>
  );
}

// One editable line's height: a generous line box so token chips on wrapped rows keep clear
// vertical air between them (a tight line-height let pills on adjacent rows touch). The field's
// single-line (collapsed) box = this line + top/bottom padding; the Insert-tag button matches
// exactly that so it's precisely one line tall and aligns with the field.
const FIELD_LINE = 26;
const FIELD_PAD_Y = 8;
const FIELD_BORDER = 1.5;
// Single-line box height (border-box): the line + top/bottom padding + top/bottom border. The
// border must be included — both the field and the button are border-box, so leaving it out makes
// the field 3px taller than the button, which reads as the button sitting higher.
const FIELD_BOX = FIELD_LINE + FIELD_PAD_Y * 2 + FIELD_BORDER * 2;
const fieldStyle: CSSProperties = { flex: 1, minHeight: FIELD_BOX, background: skin.inset, border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: `${FIELD_PAD_Y}px 10px`, fontFamily: font.family, ...roleFont('field'), color: skin.ink, lineHeight: `${FIELD_LINE}px`, outline: 'none', boxSizing: 'border-box', overflowWrap: 'anywhere' };
// Exactly one line tall — same box height as the field's collapsed state, so the button and the
// input align at the top. The dash is the affordance (an edge that takes a tag), which is why this
// control carries a border where the rest of the window carries none.
const addBtn: CSSProperties = { flex: 'none', height: FIELD_BOX, display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box', border: `1.5px dashed ${skin.line}`, background: 'transparent', cursor: cursors.clickable, borderRadius: radii.md, padding: '0 12px', fontFamily: font.family, ...roleFont('small'), color: skin.muted, whiteSpace: 'nowrap' };
const hintStyle: CSSProperties = { ...roleFont('caption'), color: skin.muted };
const menuSample: CSSProperties = { fontVariantNumeric: 'tabular-nums', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
