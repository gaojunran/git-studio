import { describe, expect, it } from 'vitest';
import { parseStatus } from './status';

describe('parseStatus', () => {
  it('parses branch headers, staged, unstaged, untracked and renames', () => {
    const raw = [
      '# branch.oid abcdef',
      '# branch.head feature',
      '# branch.upstream origin/feature',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/changed.ts',
      '? notes.md',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts',
      'src/old.ts',
      ''
    ].join('\0');

    const parsed = parseStatus(raw);
    expect(parsed.branch).toBe('feature');
    expect(parsed.upstream).toBe('origin/feature');
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(1);
    expect(parsed.files).toEqual([
      expect.objectContaining({ path: 'src/staged.ts', staged: true, unstaged: false, status: 'M' }),
      expect.objectContaining({ path: 'src/changed.ts', staged: false, unstaged: true, status: 'M' }),
      expect.objectContaining({ path: 'notes.md', status: '?', unstaged: true }),
      expect.objectContaining({ path: 'src/new.ts', oldPath: 'src/old.ts', status: 'R', staged: true })
    ]);
  });

  it('marks unmerged entries as conflicts', () => {
    const parsed = parseStatus(['# branch.head main', 'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts', ''].join('\0'));
    expect(parsed.files[0]).toEqual(expect.objectContaining({ path: 'src/conflict.ts', conflict: true, status: 'U' }));
  });

  it('reports detached HEAD', () => {
    const parsed = parseStatus(['# branch.oid abcdef', '# branch.head (detached)', ''].join('\0'));
    expect(parsed.branch).toBeNull();
  });
});
