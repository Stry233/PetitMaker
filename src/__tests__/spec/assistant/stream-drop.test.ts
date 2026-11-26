/** A provider answer whose connection drops partway is a network fault and is retried, not an incident. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { classify, isRetryable } from '../../../agent/core/errors';

describe('a connection that drops mid-answer', () => {
  spec('ASST-38', 'is retried as a network fault, whichever engine reports it', () => {
    // Node's fetch closes a dropped body with "terminated", Chrome with "network error"; neither carries a status.
    for (const message of ['terminated', 'TypeError: network error', 'socket hang up', 'other side closed']) {
      expect(classify({ message }).cls, message).toBe('network');
      expect(isRetryable(classify({ message }).cls), message).toBe(true);
    }
  });

  spec('ASST-38', 'is not read into a provider sentence that only contains the word', () => {
    expect(classify({ message: 'The request was terminated by a content filter.' }).cls).not.toBe('network');
  });
});
