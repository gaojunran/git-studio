import { describe, expect, it } from 'vitest';
import type { RefInfo } from '../../shared/protocol';
import { branchBaseName, isMainline, mainlineRank } from './baseBranch';

function ref(shortName: string, type: RefInfo['type'] = 'local'): RefInfo {
  return {
    name: type === 'remote' ? `refs/remotes/${shortName}` : `refs/heads/${shortName}`,
    shortName,
    type,
    oid: '0'.repeat(40),
    committerDate: 0,
    current: false
  };
}

describe('branchBaseName', () => {
  it('keeps local branch names and strips the remote prefix', () => {
    expect(branchBaseName(ref('release/1.0'))).toBe('release/1.0');
    expect(branchBaseName(ref('origin/release/1.0', 'remote'))).toBe('release/1.0');
    expect(branchBaseName(ref('origin/main', 'remote'))).toBe('main');
  });
});

describe('isMainline', () => {
  it('recognises common mainline names locally and remotely', () => {
    expect(isMainline(ref('main'))).toBe(true);
    expect(isMainline(ref('develop'))).toBe(true);
    expect(isMainline(ref('release/1.2'))).toBe(true);
    expect(isMainline(ref('origin/master', 'remote'))).toBe(true);
    expect(isMainline(ref('feature/login'))).toBe(false);
    expect(isMainline(ref('origin/feature/login', 'remote'))).toBe(false);
  });

  it('ignores tags', () => {
    expect(isMainline({ ...ref('v1.0'), type: 'tag' })).toBe(false);
  });
});

describe('mainlineRank', () => {
  it('orders main before master, develop and release', () => {
    expect(mainlineRank(ref('main'))).toBeLessThan(mainlineRank(ref('master')));
    expect(mainlineRank(ref('master'))).toBeLessThan(mainlineRank(ref('develop')));
    expect(mainlineRank(ref('develop'))).toBeLessThan(mainlineRank(ref('release/1.0')));
  });

  it('sorts non-mainlines last', () => {
    expect(mainlineRank(ref('feature/x'))).toBeGreaterThan(mainlineRank(ref('release/9.9')));
  });
});
