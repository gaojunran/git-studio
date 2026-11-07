import { describe, expect, it } from 'vitest';
import type { RefInfo } from '../../shared/protocol';
import { branchBaseName, isMainline, mainlineRank, sortMainlines } from './baseBranch';

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
  it('recognises only main and master as name fallbacks', () => {
    expect(isMainline(ref('main'))).toBe(true);
    expect(isMainline(ref('master'))).toBe(true);
    expect(isMainline(ref('origin/master', 'remote'))).toBe(true);
    expect(isMainline(ref('develop'))).toBe(false);
    expect(isMainline(ref('release/1.2'))).toBe(false);
    expect(isMainline(ref('feature/login'))).toBe(false);
    expect(isMainline(ref('origin/feature/login', 'remote'))).toBe(false);
  });

  it('ignores tags', () => {
    expect(isMainline({ ...ref('v1.0'), type: 'tag' })).toBe(false);
  });
});

describe('mainlineRank', () => {
  it('orders main before master', () => {
    expect(mainlineRank(ref('main'))).toBeLessThan(mainlineRank(ref('master')));
  });

  it('sorts non-mainlines last', () => {
    expect(mainlineRank(ref('feature/x'))).toBeGreaterThan(mainlineRank(ref('master')));
    expect(mainlineRank(ref('release/9.9'))).toBeGreaterThan(mainlineRank(ref('master')));
  });
});

describe('sortMainlines', () => {
  it('puts the most recently updated mainline first, regardless of name rank', () => {
    const main = { ...ref('main'), committerDate: 200 };
    const master = { ...ref('master'), committerDate: 100 };
    expect(sortMainlines([master, main]).map((entry) => entry.shortName)).toEqual(['main', 'master']);
  });
});
