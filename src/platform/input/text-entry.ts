const FIELD_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether `el` is a form field or editable content, where keys, focus and the native context
 *  menu belong to the field rather than the editor. */
export function isTextEntry(el: EventTarget | null | undefined): boolean {
  const e = el as Partial<HTMLElement> | null | undefined;
  return !!e && (e.isContentEditable === true || FIELD_TAGS.has(e.tagName ?? ''));
}
