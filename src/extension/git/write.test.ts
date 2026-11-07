import { describe, expect, it } from 'vitest';
import { GitError } from './cli';
import { isConflict } from './write';

describe('isConflict', () => {
  it('detects cherry-pick and revert conflicts', () => {
    expect(isConflict(new GitError('git cherry-pick exited', 1, 'error: could not apply abc1234...', []))).toBe(true);
    expect(isConflict(new GitError('git revert exited', 1, 'CONFLICT (content): Merge conflict in a.ts', []))).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isConflict(new GitError('bad revision', 128, 'fatal: bad revision', []))).toBe(false);
    expect(isConflict(new Error('CONFLICT'))).toBe(false);
  });
});
