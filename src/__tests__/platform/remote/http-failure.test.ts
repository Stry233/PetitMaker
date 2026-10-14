import { describe, expect, it } from 'vitest';
import { httpFailureKind } from '../../../platform/remote/http-failure';
import { classify as classifyTurn } from '../../../agent/core/errors';
import { classify as classifyStylize } from '../../../pipelines/stylize/dialects/errors';

describe('httpFailureKind', () => {
  it.each([
    [401, 'invalid api key', 'auth'],
    [402, '', 'quota'],
    [403, 'forbidden', 'auth'],
    [403, 'insufficient_quota', 'quota'],
    [403, 'account balance is overdue', 'quota'],
    [403, 'monthly usage limit reached', 'quota'],
    [408, '', 'rate-limit'],
    [409, '', 'rate-limit'],
    [429, '', 'rate-limit'],
    [500, '', 'server'],
    [503, '', 'server'],
    [400, 'bad request', 'client'],
    [404, 'not found', 'client'],
  ] as const)('reads %i %j as %s', (status, message, kind) => {
    expect(httpFailureKind(status, message)).toBe(kind);
  });

  it('is null for a status that is not a failure', () => {
    expect(httpFailureKind(200, '')).toBeNull();
    expect(httpFailureKind(0, '')).toBeNull();
  });

  it('keeps a load balancer complaint on a 403 a rejected key', () => {
    expect(httpFailureKind(403, 'denied by the load balancer')).toBe('auth');
  });
});

describe('the assistant and the illustration services read a status alike', () => {
  it.each([
    [401, 'nope', 'auth', 'bad_key'],
    [403, 'forbidden', 'auth', 'bad_key'],
    [403, 'billing hard limit reached', 'quota', 'refused'],
    [402, 'payment required', 'quota', 'refused'],
    [429, 'slow down', 'rate-limit', 'refused'],
  ] as const)('%i %j', (status, message, turn, stylize) => {
    expect(classifyTurn({ status, message }).cls).toBe(turn);
    expect(classifyStylize(status, message).status).toBe(stylize);
  });
});
