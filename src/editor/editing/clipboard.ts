/*
 * Copy, cut and paste of objects on the live editor (EDIT-53 to EDIT-63): the store's copy, the
 * system clipboard and the other tabs of this browser, and the toasts each verb raises.
 *
 * Three places hold a copy. The store's `clipboard` is the page's own and works with no clipboard
 * permission at all. The system clipboard gets the copy as text (`io/clipboard/payload.ts`) on the
 * browser's own `copy` event when a key copied, or through `navigator.clipboard.writeText` from a
 * button, and gives it back on the `paste` event, which needs no permission prompt; so Ctrl+V in
 * another tab, window or browser places it. Tabs of this browser on this site also hear each copy
 * on a broadcast channel, so their menus offer Paste at once.
 */
import { useEditorStore } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import { copyAllowed, pasteOffered, type Arrangement } from '../../state/clipboard';
import { activeToolOf, armedItemOf, armedMacroOf, holdsSelection } from '../../state/editing/edit-mode';
import { cellAtPoint } from '../../core/grid/pointer';
import { PLACEMENT_GRID } from '../../core/game/profile';
import type { MacroCoord } from '../../core/model/types';
import { copyArrangement, pasteAt as pasteArrangementAt, type PasteAim, type PasteDoor } from '../../tools/objects';
import { decodeArrangement, encodeArrangement } from '../../io/clipboard/payload';
import { getActiveView } from '../../view/active-view';
import { translate } from '../../i18n/context';
import { copyNotices, pasteNotices, type CopyNotice } from '../../i18n/terms/copy-notices';
import { showToast } from '../../platform/channels/toast-bus';
import { SUPPORTS_CLIPBOARD } from '../../platform/build/edition';
import { isTextEntry } from '../../platform/input/text-entry';
import { anyOverlayOpen } from '../../platform/channels/overlay-state';
import { host } from '../host/host';
import { currentEditor } from '../session/context';
import { deleteSelection } from './group-edit';

const store = () => useEditorStore.getState();
const say = (notices: readonly CopyNotice[]): void => { for (const n of notices) showToast(n.text, n.tone); };

/** The channel the tabs of this site share copies on. */
const CHANNEL = 'petitmaker.clipboard';
let channel: BroadcastChannel | null = null;

/** Text a key's copy waits to hand the browser's `copy` event; written by `writeText` if no event
 *  takes it (a copy rebound to another key). */
let owedText: string | null = null;
/** A paste key was pressed: its `paste` event may yet bring a copy from the system clipboard, else
 *  the page's own copy is pasted. */
let pasteOwed = false;

/** Whether the page holds selected text, which a copy key copies instead of objects. */
function textSelected(): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection?.();
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}

/** Hands `text` to the system clipboard: through the key's own `copy` event when `fromKey`, else
 *  through the asynchronous clipboard, whose refusal leaves the page's copy standing. */
function writeSystem(text: string, fromKey: boolean): void {
  if (!SUPPORTS_CLIPBOARD) return;
  channel?.postMessage(text);
  const write = (): void => { void navigator.clipboard?.writeText(text).catch(() => {}); };
  if (!fromKey) { write(); return; }
  owedText = text;
  setTimeout(() => { if (owedText === text) { owedText = null; write(); } }, 0);
}

/**
 * Copies `ids` (the selection when omitted) into the page's copy and the system clipboard and says
 * what it took. Returns whether anything was copied. `fromKey` names a copy key, whose own `copy`
 * event carries the text.
 */
export function copyObjects(ids?: readonly string[], fromKey = false): boolean {
  const s = store();
  if (!s.gridState || !copyAllowed(s)) return false;
  const taken = copyArrangement(s.gridState, ids ?? selectedObjectIds(s.selection));
  if (taken.arrangement === null && taken.leftOut === 0) return false;
  if (taken.arrangement) {
    s.setClipboard(taken.arrangement);
    writeSystem(encodeArrangement(taken.arrangement), fromKey);
  }
  say(copyNotices(translate, { copied: taken.arrangement?.members.length ?? 0, leftOut: taken.leftOut }));
  return taken.arrangement !== null;
}

/** The copy key: objects, unless the page holds selected text, which the browser copies. */
export function copyKey(): void {
  if (textSelected()) return;
  copyObjects(undefined, true);
}

/** The cut key: copies the selection, then deletes it as Delete does, locked members kept (EDIT-61). */
export function cutKey(): void {
  if (textSelected()) return;
  const ids = selectedObjectIds(store().selection);
  if (ids.length === 0 || !copyObjects(ids, true)) return;
  deleteSelection(translate, ids);
}

/** The paste key: the system clipboard's copy when its `paste` event brings one, else the page's. */
export function pasteKey(): void {
  pasteOwed = true;
  setTimeout(() => { if (pasteOwed) { pasteOwed = false; pasteFromKey(); } }, 0);
}

/** The placement cell under screen point (x, y) on the view showing, or null without one. */
export function cellAtScreen(x: number, y: number): MacroCoord | null {
  const view = getActiveView();
  return view ? cellAtPoint(view.projection.screenToPoint(x, y), PLACEMENT_GRID) : null;
}

const clamp = (v: number, hi: number): number => Math.min(Math.max(v, 0), Math.max(hi, 0));

/**
 * Where the paste key aims (EDIT-54), never at the pointer: the picked block as the copy's
 * top-left when one is picked, else inside the painted region when one is painted, else the open
 * ground nearest the copy's own origin, held on this map, so a copy from another map lands where it
 * stood there; a copy with no origin starts from the map's middle.
 */
function keyAim(a: Arrangement): PasteAim | null {
  const s = store();
  if (s.pickedCell) return { kind: 'cell', cell: s.pickedCell };
  if (s.region.length > 0) return { kind: 'region', cells: s.region };
  const t = s.gridState?.template;
  if (!t) return null;
  const from = a.origin ?? { x: Math.floor((t.width - a.w) / 2), y: Math.floor((t.height - a.h) / 2) };
  return { kind: 'near', origin: { x: clamp(from.x, t.width - a.w), y: clamp(from.y, t.height - a.h) } };
}

/** The paste key's body: one copy where `keyAim` aims, or a word that nothing is copied. */
export function pasteFromKey(): void {
  const s = store();
  if (!copyAllowed(s)) return;
  if (!s.clipboard) { showToast(translate('paste.empty'), 'info'); return; }
  const aim = keyAim(s.clipboard);
  if (aim) pasteAt(aim);
}

/** Places one copy with its top-left on `cell`, as the map menu's Paste does (EDIT-56). */
export function pasteAtCell(cell: MacroCoord): void {
  pasteAt({ kind: 'cell', cell });
}

/**
 * Places one copy where `aim` asks or nearby (EDIT-57), says what it came to, and selects what it
 * placed, so the copy can be moved, turned, deleted or copied on at once. An armed item or planting
 * is put down, as a Ctrl selection puts it down, and a brush gives way to the Hand tool.
 */
function pasteAt(aim: PasteAim): void {
  const ed = currentEditor();
  const s = store();
  if (!ed || !s.clipboard || !pasteOffered(s)) return;
  const { executor } = ed;
  const door: PasteDoor = {
    state: ed.state, registry: executor.getRegistry(),
    execute: (cmd) => executor.execute(cmd), beginStroke: () => executor.beginStroke(),
  };
  const outcome = pasteArrangementAt(door, s.clipboard, aim, (obj) => host.feedback.plop(obj.id));
  say(pasteNotices(translate, outcome));
  if (outcome.placed.length === 0) return;
  const now = store();
  if (armedItemOf(now) || armedMacroOf(now) || !holdsSelection(activeToolOf(now))) now.setEditMode({ arm: { kind: 'none' } });
  store().setSelection(outcome.placed.map((id) => ({ kind: 'object', id }) as const), { record: false });
}

/** Takes a copy another tab or the system clipboard brought in as the page's own, saying, when
 *  `announce`, why it could not or what it left out. */
function adopt(text: string, announce: boolean): Arrangement | null {
  const read = decodeArrangement(text);
  if (read.kind === 'future' && announce) showToast(translate('paste.future'), 'warning');
  if (read.kind !== 'ok') return null;
  if (announce) say(pasteNotices(translate, { nearby: false, noRoom: false, capped: 0, unknown: read.unknown }));
  if (read.arrangement) store().setClipboard(read.arrangement);
  return read.arrangement;
}

/** The browser's `copy` and `cut` events after a key copied objects: they carry the copy's text. */
function onCopy(e: ClipboardEvent): void {
  if (owedText === null || isTextEntry(e.target) || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', owedText);
  e.preventDefault();
  owedText = null;
}

/** The browser's `paste` event: a copy from the system clipboard is taken and pasted; any other text
 *  is left to the page, and a text field keeps its own paste. */
function onPaste(e: ClipboardEvent): void {
  if (!pasteOwed || isTextEntry(e.target) || anyOverlayOpen()) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const read = decodeArrangement(text);
  if (read.kind === 'not-a-copy' || read.kind === 'malformed') return;
  e.preventDefault();
  pasteOwed = false;
  if (adopt(text, true)) pasteFromKey();
}

/** Installs the clipboard's page listeners and the tabs' channel; returns the stop. */
export function installClipboardBridge(): () => void {
  if (!SUPPORTS_CLIPBOARD || typeof document === 'undefined') return () => {};
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<unknown>) => { if (typeof e.data === 'string') adopt(e.data, false); };
  }
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('paste', onPaste);
    channel?.close();
    channel = null;
  };
}
