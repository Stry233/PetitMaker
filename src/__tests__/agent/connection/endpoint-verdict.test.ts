/** An endpoint fails its check when nothing answered or no request could be built; any server
 *  answer, however unhelpful, only makes the model list unavailable. */
import { describe, it, expect } from 'vitest';
import { endpointCheckVerdict } from '../../../agent/connection/model-discovery';
import { NO_ENDPOINT_ADDRESS } from '../../../agent/core/errors';

describe('what counts as the endpoint failing its check', () => {
  const UNREACHABLE: [string, unknown][] = [
    ['a fetch that failed', new Error('Failed to fetch')],
    ['a check the deadline ended', new Error('The endpoint answered nothing in 8s; the request timed out.')],
    ['a CORS-shaped opaque refusal', Object.assign(new Error('blocked'), { status: 0 })],
    ['a request that could not be built', new Error(NO_ENDPOINT_ADDRESS)],
  ];
  const ANSWERED: [string, unknown][] = [
    ['an auth refusal', Object.assign(new Error('Unauthorized'), { status: 401 })],
    ['a rate limit', Object.assign(new Error('Too many requests'), { status: 429 })],
    ['a gateway with no models route', Object.assign(new Error('Not Found'), { status: 404 })],
    ['a server fault', Object.assign(new Error('Internal Server Error'), { status: 500 })],
  ];

  it.each(UNREACHABLE)('%s is the endpoint failing', (_name, err) => {
    expect(endpointCheckVerdict(err)).toBe('unreachable');
  });

  it.each(ANSWERED)('%s is a server that answered, so only the list is unavailable', (_name, err) => {
    expect(endpointCheckVerdict(err)).toBe('no-list');
  });
});
