/** What a landed generation says, read from the toasts reporting its outcome raises. */
import { describe, it, expect } from 'vitest';
import { reportGenerate } from '../../../editor/editing/generate-report';
import type { Outcome } from '../../../editor/operations';
import { setToastPresenter, type ToastType } from '../../../platform/channels/toast-bus';
import { translate } from '../../../i18n/context';
import type { I18nKey } from '../../../i18n/keys';
import type { StencilKind } from '../../../tools/generation/kinds';
import type { StencilDetail } from '../../../tools/generation/run/outcome';

const stencil = (over: Omit<StencilDetail, 'kind'>): Pick<Outcome, 'detail'> => ({ detail: { kind: 'stencil', ...over } });

const landed = (over: Partial<Outcome> = {}): Outcome => ({
  cells: [], placed: 10, removedCells: 0, removedObjects: 0, violations: [], cancelled: false, ...over,
});

interface Toast { text: string; kind: ToastType }

/** The toasts reporting `outcome` raises, in order, and whether the run counted as landed. */
function report(outcome: Outcome, kind: StencilKind | null): { toasts: Toast[]; landed: boolean } {
  const toasts: Toast[] = [];
  const stop = setToastPresenter((text, type) => { toasts.push({ text, kind: type }); });
  try {
    return { landed: reportGenerate(outcome, kind), toasts };
  } finally { stop(); }
}

/** The toast a notice reads as: its key's copy with its count. */
const toast = (key: I18nKey, n: number, kind: ToastType): Toast => ({ text: translate(key, { n }), kind });

type Landing = NonNullable<StencilDetail['landing']>;
/** What a stencil run of `kind` that placed `placed` says about its landing, text only. */
const says = (kind: 'text' | 'image', landing: Landing | undefined, placed: number) =>
  report(landed({ placed, ...(landing ? stencil({ landing }) : {}) }), kind).toasts.map((t) => t.text);
const none: Landing = { base: 0, offBase: 0, unsupported: 0, atCeiling: 0 };

describe('a run that laid nothing', () => {
  it('names the kind it was building, since a picture is not a word', () => {
    // The buckets the note reads are a letter's — the ground's answer to a glyph standing one
    // layer on it — and a picture's run never reports them, so a picture only ever reaches the
    // nothing-laid line. Sharing the letter's copy would tell someone building a picture that none
    // of their word fit.
    expect(says('text', undefined, 0)).toEqual([translate('generate.text_nothing_laid', { n: 0 })]);
    expect(says('image', undefined, 0)).toEqual([translate('generate.picture_nothing_laid', { n: 0 })]);
    expect(says('text', none, 0)).toEqual([translate('generate.text_nothing_laid', { n: 0 })]);
    expect(says('image', none, 0)).toEqual([translate('generate.picture_nothing_laid', { n: 0 })]);
  });

  it('says nothing at all when something was laid and nothing was left out', () => {
    expect(says('text', undefined, 12)).toEqual([]);
    expect(says('text', none, 12)).toEqual([]);
  });
});

describe('the notices a run gives', () => {
  it('says only that the run was refused when the budget blocked it, and counts nothing landed', () => {
    const blocked = report(landed({ ...stencil({ budget: 'blocked' }), scopeEmpty: 'reclaimed' }), 'text');
    expect(blocked.toasts).toEqual([toast('generate.budget_blocked', 0, 'warning')]);
    expect(blocked.landed).toBe(false);
  });

  it('names reclaimed ground ahead of a thinned run', () => {
    expect(report(landed({ placed: 0, scopeEmpty: 'reclaimed', ...stencil({ budget: 'adapted' }) }), null).toasts.map((t) => t.text))
      .toEqual([translate('generate.scope_reclaimed', { n: 0 }), translate('generate.budget_adapted', { n: 0 })]);
  });

  it('warns when a picture laid nothing and only notes a short one', () => {
    expect(report(landed({ placed: 0 }), 'image').toasts).toEqual([toast('generate.picture_nothing_laid', 0, 'warning')]);
    expect(report(landed(stencil({ landing: { base: 0, offBase: 2, unsupported: 0, atCeiling: 0 } })), 'text').toasts)
      .toEqual([toast('generate.text_off_base', 2, 'info')]);
  });

  it('says nothing for a terrain kind that landed', () => {
    const plain = report(landed(), null);
    expect(plain.toasts).toEqual([]);
    expect(plain.landed).toBe(true);
  });
});
