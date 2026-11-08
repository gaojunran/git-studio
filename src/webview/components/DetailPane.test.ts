import { describe, expect, it } from 'vitest';
import { messageLinks } from './DetailPane';

describe('messageLinks', () => {
  it('finds issue and pull references plus urls', () => {
    const links = messageLinks('fix #12 and !34, see https://github.com/o/r/pull/56', []);
    expect(links.map((link) => `${link.kind}-${link.number}`)).toEqual(['pull-56', 'pull-34', 'issue-12']);
  });

  it('prefers a provider item over a bare number', () => {
    const links = messageLinks('#12', [
      {
        providerId: 'github',
        providerLabel: 'GitHub',
        kind: 'pull',
        number: 12,
        title: 'PR',
        state: 'open',
        url: 'https://github.com/o/r/pull/12'
      }
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'pull', number: 12, providerId: 'github' });
  });
});
