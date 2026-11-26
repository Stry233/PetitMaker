const FIELD_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether `el` is a form field or editable content, where keys, focus and the native context
 *  menu belong to the field rather than the editor. */
export function isTextEntry(el: EventTarget | null | undefined): boolean {
  const e = el as Partial<HTMLElement> | null | undefined;
  return !!e && (e.isContentEditable === true || FIELD_TAGS.has(e.tagName ?? ''));
}

/** Input types a touch device types into with its software keyboard; the rest open a picker or
 *  take no text. */
const TYPED_INPUTS: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Whether focusing `el` raises a software keyboard on a touch device: a text entry other than a
 *  select, a slider, a checkbox or a picker. */
export function raisesKeyboard(el: EventTarget | null | undefined): boolean {
  if (!isTextEntry(el)) return false;
  const e = el as Partial<HTMLInputElement>;
  if (e.tagName === 'SELECT') return false;
  return e.tagName !== 'INPUT' || TYPED_INPUTS.has(e.type ?? 'text');
}

/** Whether a key event belongs to an IME composition rather than to the field it lands in: Safari
 *  reports the committing Enter with `keyCode` 229 and `isComposing` false, and some IMEs end the
 *  composition before they dispatch the confirming keydown. */
export function isComposingKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
