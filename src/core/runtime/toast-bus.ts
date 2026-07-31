/**
 * The toast emitter: a module-level channel any layer can post a message on without reaching for
 * the React tree.
 *
 * A toast is a request, not a render. `showToast` hands the text to whatever presenter is
 * currently registered, so a tool that has to report a post-stroke rollback (the one case where a
 * tool speaks to the user directly) names the message and nothing else. `ToastContainer` registers
 * itself while mounted; with no presenter the call is a no-op, which is what keeps headless tests
 * and the offline render harnesses free of UI.
 */
export type ToastType = 'error' | 'info' | 'warning';

export type ToastPresenter = (text: string, type: ToastType) => void;

let presenter: ToastPresenter | null = null;

/** Post a message. Silently dropped when nothing is presenting. */
export function showToast(text: string, type: ToastType = 'info'): void {
  presenter?.(text, type);
}

/** Register the presenter for as long as it is mounted; returns its unregister. */
export function setToastPresenter(next: ToastPresenter): () => void {
  presenter = next;
  return () => { if (presenter === next) presenter = null; };
}
