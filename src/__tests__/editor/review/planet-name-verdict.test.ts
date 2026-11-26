/** A planet name the text check approved is recorded once, by the check itself, whether a field's
 *  session or a name given to a command had it checked; a refused one and another kind of name are not. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const review = vi.hoisted(() => ({ refused: new Set<string>(), checked: [] as string[] }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (load) => ({
  ...await load<typeof import('../../../pipelines/moderation/text/reviewer')>(),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => {
    review.checked.push(...parts.map((p) => p.text));
    return { allowed: !parts.some((p) => review.refused.has(p.text)) };
  }),
}));

import { createReviewedTextSession } from '../../../editor/review/text-session';
import { givenNameIssue } from '../../../editor/review/text-review';
import { __resetTextVerdicts, textVerdict } from '../../../state/text-verdicts';

beforeEach(() => { __resetTextVerdicts(); review.refused.clear(); review.checked.length = 0; });

describe('a checked planet name', () => {
  it('given to a command is recorded as approved, and is not checked again as it is given on', async () => {
    expect(await givenNameIssue('Quay one', '', 'planet')).toBeNull();
    expect(textVerdict('Quay one')).toBe('approved');
    expect(givenNameIssue('Quay one', '', 'planet'), 'answered within the press').toBeNull();
    expect(review.checked).toEqual(['Quay one']);
  });

  it('typed in a name field is recorded as approved by its check, with no surface recording it', async () => {
    const session = createReviewedTextSession();
    session.watch({ open: true, text: 'Cove two', known: '', field: 'planet', composing: false });
    await vi.waitFor(() => expect(textVerdict('Cove two')).toBe('approved'));
    expect(givenNameIssue('Cove two', '', 'planet')).toBeNull();
    session.release();
  });

  it('refused, or the name of something else, records no approval', async () => {
    review.refused.add('Refused three');
    expect(await givenNameIssue('Refused three', '', 'planet')).toBe('refused');
    expect(textVerdict('Refused three')).toBe('unchecked');
    expect(await givenNameIssue('Folder four', '', 'blueprint-folder')).toBeNull();
    expect(textVerdict('Folder four')).toBe('unchecked');
  });
});
