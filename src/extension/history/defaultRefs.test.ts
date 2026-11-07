import { describe, expect, it } from 'vitest';
import type { RefInfo } from '../../shared/protocol';
import { selectDefaultRefs } from './defaultRefs';

function ref(partial: Partial<RefInfo> & Pick<RefInfo, 'name' | 'shortName' | 'type'>): RefInfo {
  return {
    oid: partial.name,
    committerDate: 0,
    current: false,
    ...partial
  };
}

const refs: RefInfo[] = [
  ref({ name: 'refs/heads/main', shortName: 'main', type: 'local', committerDate: 100, current: true, upstream: 'origin/main' }),
  ref({ name: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote', committerDate: 90 }),
  ref({ name: 'refs/heads/feature-a', shortName: 'feature-a', type: 'local', committerDate: 80 }),
  ref({ name: 'refs/heads/feature-b', shortName: 'feature-b', type: 'local', committerDate: 70 }),
  ref({ name: 'refs/heads/release/1.0', shortName: 'release/1.0', type: 'local', committerDate: 60 }),
  ref({ name: 'refs/remotes/origin/noise', shortName: 'origin/noise', type: 'remote', committerDate: 50 }),
  ref({ name: 'refs/tags/v1', shortName: 'v1', type: 'tag', committerDate: 40 })
];

describe('selectDefaultRefs', () => {
  it('returns no filter for all mode', () => {
    expect(selectDefaultRefs(refs, { mode: 'all', recentLimit: 2, pinned: [] })).toEqual([]);
  });

  it('keeps only the current branch for current mode', () => {
    expect(selectDefaultRefs(refs, { mode: 'current', recentLimit: 2, pinned: [] })).toEqual(['refs/heads/main']);
  });

  it('includes current, upstream, primary and recent local branches', () => {
    const selected = selectDefaultRefs(refs, { mode: 'primary', recentLimit: 2, pinned: [] });

    expect(selected).toContain('refs/heads/main');
    expect(selected).toContain('refs/remotes/origin/main');
    expect(selected).toContain('refs/heads/feature-a');
    expect(selected).toContain('refs/heads/feature-b');
    expect(selected).not.toContain('refs/heads/release/1.0');
    expect(selected).not.toContain('refs/remotes/origin/noise');
  });

  it('adds pinned refs by glob', () => {
    const selected = selectDefaultRefs(refs, { mode: 'current', recentLimit: 0, pinned: ['release/*', 'v1'] });

    expect(selected).toEqual(['refs/heads/main', 'refs/heads/release/1.0', 'refs/tags/v1']);
  });

  it('falls back to HEAD when detached', () => {
    const detached = refs.map((entry) => ({ ...entry, current: false }));
    expect(selectDefaultRefs(detached, { mode: 'current', recentLimit: 0, pinned: [] })).toEqual(['HEAD']);
  });

  it('falls back to recent local branches when nothing matches', () => {
    const odd = [
      ref({ name: 'refs/heads/x', shortName: 'x', type: 'local', committerDate: 10 }),
      ref({ name: 'refs/heads/y', shortName: 'y', type: 'local', committerDate: 20 })
    ];
    expect(selectDefaultRefs(odd, { mode: 'primary', recentLimit: 1, pinned: [] })).toEqual(['HEAD', 'refs/heads/y']);
  });
});
