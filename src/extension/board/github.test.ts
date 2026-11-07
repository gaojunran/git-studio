import { describe, expect, it } from 'vitest';
import { parseGitHubRemote } from './github';

describe('parseGitHubRemote', () => {
  it('reads an https remote', () => {
    expect(parseGitHubRemote('https://github.com/mona/teapot.git')).toEqual({
      owner: 'mona',
      name: 'teapot',
      url: 'https://api.github.com/repos/mona/teapot'
    });
  });

  it('reads an ssh remote', () => {
    expect(parseGitHubRemote('git@github.com:mona/teapot.git')?.name).toBe('teapot');
  });

  it('ignores another host', () => {
    expect(parseGitHubRemote('https://gitlab.com/mona/teapot.git')).toBeUndefined();
  });

  it('ignores a missing remote', () => {
    expect(parseGitHubRemote(undefined)).toBeUndefined();
  });
});
