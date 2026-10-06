import { describe, expect, it } from 'vitest';
import { createHostTokenTaker, extractHostToken } from './host-token.js';

function run(hash: string, search = '') {
  const calls: string[] = [];
  const token = extractHostToken(
    { pathname: '/play', search, hash },
    { replaceState: (_d, _u, url) => void calls.push(url) },
  );
  return { token, calls };
}

describe('extractHostToken', () => {
  it('reads the token from the fragment and clears it from the URL', () => {
    expect(run('#host=abc_-1')).toEqual({ token: 'abc_-1', calls: ['/play'] });
  });
  it('keeps other fragment params and the query string', () => {
    expect(run('#a=1&host=t', '?x=2')).toEqual({ token: 't', calls: ['/play?x=2#a=1'] });
  });
  it('does nothing without a token, and ignores the query string', () => {
    expect(run('')).toEqual({ token: undefined, calls: [] });
    expect(run('#other=1')).toEqual({ token: undefined, calls: [] });
    expect(run('', '?host=nope')).toEqual({ token: undefined, calls: [] });
  });
  it('treats an empty token as absent but still scrubs it', () => {
    expect(run('#host=')).toEqual({ token: undefined, calls: ['/play'] });
  });
});

describe('createHostTokenTaker', () => {
  it('returns the token once', () => {
    const take = createHostTokenTaker('t');
    expect(take()).toBe('t');
    expect(take()).toBeUndefined();
  });
});
