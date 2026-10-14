/** What a landed generation says to the visitor, from the outcome its operation returned. */
import { showToast, type ToastType } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { budgetBlocked, stencilDetail, type Outcome, type StencilOutcome } from '../../tools/generation/run';
import type { I18nKey } from '../../i18n/keys';
import type { StencilKind } from '../../tools/generation/kinds';

interface GenerateNotice { key: I18nKey; n: number; kind: ToastType }

type Bucket = [key: I18nKey, n: number];
const said = ([key, n]: Bucket): { key: I18nKey; n: number } => ({ key, n });

/**
 * Chooses one localized outcome: ceiling when nothing could be placed, otherwise the largest rejection bucket.
 * Ties follow off-base, unsupported, then ceiling order; `n` selects the key's plural form.
 */
function stencilNote(kind: StencilKind, s: StencilOutcome | undefined, placed: number): { key: I18nKey; n: number } | null {
  const nothing = kind === 'image' ? 'generate.picture_nothing_laid' : 'generate.text_nothing_laid';
  if (placed === 0 && !s) return { key: nothing, n: 0 };
  if (!s) return null;
  const ceiling: Bucket = ['generate.text_at_ceiling', s.atCeiling];
  if (placed === 0 && s.atCeiling > 0) return said(ceiling);
  const worst = ([
    ['generate.text_off_base', s.offBase],
    ['generate.text_unsupported', s.unsupported],
    ceiling,
  ] as Bucket[]).reduce((a, b) => (b[1] > a[1] ? b : a));
  if (worst[1] > 0) return said(worst);
  return placed === 0 ? { key: nothing, n: 0 } : null;
}

/**
 * The notices a landed run gives, in order. Ground that had to be handed back outranks a shape's
 * own shortfall, and a thinned run adds its own note after either.
 */
function generateNotices(outcome: Outcome, stencil: StencilKind | null): GenerateNotice[] {
  const detail = stencilDetail(outcome);
  if (detail?.budget === 'blocked') return [{ key: 'generate.budget_blocked', n: 0, kind: 'warning' }];
  const notices: GenerateNotice[] = [];
  const note = stencil ? stencilNote(stencil, detail?.landing, outcome.placed) : null;
  if (outcome.scopeEmpty === 'reclaimed') notices.push({ key: 'generate.scope_reclaimed', n: 0, kind: 'warning' });
  else if (note) notices.push({ ...note, kind: outcome.placed === 0 ? 'warning' : 'info' });
  if (detail?.budget === 'adapted') notices.push({ key: 'generate.budget_adapted', n: 0, kind: 'info' });
  return notices;
}

/** Shows the run's notices; false when the run was refused outright and nothing landed. */
export function reportGenerate(outcome: Outcome, stencil: StencilKind | null): boolean {
  for (const notice of generateNotices(outcome, stencil)) showToast(translate(notice.key, { n: notice.n }), notice.kind);
  return !budgetBlocked(outcome);
}
