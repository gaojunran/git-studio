import { describe, expect, it } from 'vitest';
import { buildLogArgs, parseLog } from './log';

const FIELD = '\x1f';
const RECORD = '\x00';

function record(fields: string[]): string {
  return `${fields.join(FIELD)}${RECORD}`;
}

describe('buildLogArgs', () => {
  it('uses -L for a line range instead of a pathspec', () => {
    const args = buildLogArgs({ refs: [], path: 'src/a.ts', lineRange: '10,20', follow: true, skip: 0, limit: 50 });
    expect(args).toContain('-L10,20:src/a.ts');
    expect(args).not.toContain('--follow');
    expect(args).not.toContain('--');
  });

  it('uses exactly one revision for a line range', () => {
    const args = buildLogArgs({
      refs: ['refs/heads/develop', 'HEAD'],
      path: 'src/a.ts',
      lineRange: '10,20',
      skip: 0,
      limit: 50
    });
    expect(args).toContain('HEAD');
    expect(args).not.toContain('refs/heads/develop');
    expect(args).not.toContain('--all');
  });
});

describe('parseLog', () => {
  it('parses commits, parents, refs and unicode subjects', () => {
    const stdout =
      record(['a'.repeat(40), 'aaaaaaa', 'b'.repeat(40) + ' ' + 'c'.repeat(40), 'Ann', 'ann@example.com', '1700000000', '1700000100', 'HEAD -> main, tag: v1.0', 'feat: 中文 subject']) +
      record(['b'.repeat(40), 'bbbbbbb', '', 'Bob', 'bob@example.com', '1690000000', '1690000001', '', 'fix: empty refs']);

    const rows = parseLog(stdout);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      hash: 'a'.repeat(40),
      shortHash: 'aaaaaaa',
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      authorName: 'Ann',
      authorEmail: 'ann@example.com',
      authorDate: 1700000000,
      commitDate: 1700000100,
      refs: ['HEAD -> main', 'tag: v1.0'],
      subject: 'feat: 中文 subject'
    });
    expect(rows[1].parents).toEqual([]);
    expect(rows[1].refs).toEqual([]);
    expect(rows[1].subject).toBe('fix: empty refs');
  });

  it('ignores empty records and leading newlines', () => {
    const stdout = '\n' + record(['a'.repeat(40), 'aaaaaaa', '', 'A', '', '0', '0', '', 'x']) + '\n' + RECORD;
    const rows = parseLog(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('x');
  });
});

describe('buildLogArgs', () => {
  it('passes multiple literal paths after --', () => {
    const args = buildLogArgs({
      refs: ['HEAD'],
      paths: ['src', 'docs/a b.md'],
      skip: 0,
      limit: 10
    });
    const separator = args.indexOf('--');
    expect(separator).toBeGreaterThan(-1);
    expect(args.slice(separator + 1)).toEqual([':(literal)src', ':(literal)docs/a b.md']);
  });

  it('builds a filtered query without ref filters', () => {
    const args = buildLogArgs({
      refs: [],
      path: 'src/a.ts',
      follow: true,
      author: 'Ann',
      message: 'fix',
      regex: true,
      caseSensitive: false,
      firstParent: true,
      noMerges: true,
      since: '2024-01-01',
      until: '2024-02-01',
      order: 'topo',
      skip: 100,
      limit: 50
    });

    expect(args).toContain('--all');
    expect(args).toContain('--topo-order');
    expect(args).toContain('--first-parent');
    expect(args).toContain('--no-merges');
    expect(args).toContain('--author=Ann');
    expect(args).toContain('--extended-regexp');
    expect(args).toContain('--regexp-ignore-case');
    expect(args).toContain('--grep=fix');
    expect(args).toContain('--follow');
    expect(args).toContain('--skip=100');
    expect(args).toContain('--max-count=51');
    expect(args[args.length - 2]).toBe('--');
    expect(args[args.length - 1]).toBe(':(literal)src/a.ts');
  });

  it('supports merge-only and hash lookups', () => {
    const merges = buildLogArgs({ refs: [], mergesOnly: true, skip: 0, limit: 10 });
    expect(merges).toContain('--merges');
    expect(merges).not.toContain('--no-merges');

    const hash = buildLogArgs({ refs: [], hash: 'abc1234', skip: 0, limit: 10 });
    expect(hash).toContain('abc1234^!');
    expect(hash).not.toContain('--all');
  });

  it('uses refs instead of --all and fixed strings by default', () => {
    const args = buildLogArgs({
      refs: ['refs/heads/main'],
      message: 'a.b',
      skip: 0,
      limit: 10
    });

    expect(args).toContain('refs/heads/main');
    expect(args).not.toContain('--all');
    expect(args).toContain('--fixed-strings');
    expect(args).toContain('--regexp-ignore-case');
  });
});
