import { describe, expect, it } from 'vitest';
import { commitUrl, normalizeRemoteUrl, pickRemoteUrl } from './remote';

describe('normalizeRemoteUrl', () => {
  it('converts scp-style ssh remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  it('converts ssh and git protocols', () => {
    expect(normalizeRemoteUrl('ssh://git@gitlab.com/group/repo.git')).toBe('https://gitlab.com/group/repo');
    expect(normalizeRemoteUrl('git://example.com/repo.git')).toBe('https://example.com/repo');
  });

  it('keeps https remotes and strips trailing slashes', () => {
    expect(normalizeRemoteUrl('https://github.com/owner/repo/')).toBe('https://github.com/owner/repo');
  });

  it('rejects local paths', () => {
    expect(normalizeRemoteUrl('/tmp/repo.git')).toBeUndefined();
    expect(normalizeRemoteUrl('')).toBeUndefined();
  });
});

describe('commitUrl', () => {
  it('builds provider-specific commit links', () => {
    expect(commitUrl('git@github.com:owner/repo.git', 'abc123')).toBe('https://github.com/owner/repo/commit/abc123');
    expect(commitUrl('https://gitlab.com/group/repo.git', 'abc123')).toBe('https://gitlab.com/group/repo/-/commit/abc123');
    expect(commitUrl('https://bitbucket.org/team/repo.git', 'abc123')).toBe('https://bitbucket.org/team/repo/commits/abc123');
  });

  it('returns undefined for unknown hosts', () => {
    expect(commitUrl('https://git.example.com/team/repo.git', 'abc123')).toBeUndefined();
  });

  it('uses a custom template', () => {
    expect(commitUrl('https://git.example.com/team/repo.git', 'abc123', '{url}/commits/{hash}')).toBe(
      'https://git.example.com/team/repo/commits/abc123'
    );
  });
});

describe('pickRemoteUrl', () => {
  it('prefers origin', () => {
    expect(pickRemoteUrl([
      { name: 'upstream', fetchUrl: 'https://github.com/up/repo.git' },
      { name: 'origin', fetchUrl: 'https://github.com/me/repo.git' }
    ])).toBe('https://github.com/me/repo.git');
  });
});
