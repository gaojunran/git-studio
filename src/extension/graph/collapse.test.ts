import { describe, expect, it } from 'vitest';
import type { CommitRow } from '../../shared/protocol';
import { collapseLinearRows } from './collapse';

function row(hash: string, parents: string[], refs: string[] = []): CommitRow {
  return {
    hash,
    shortHash: hash,
    subject: hash,
    authorName: 'a',
    authorEmail: 'a@example.com',
    authorDate: 0,
    commitDate: 0,
    parents,
    refs
  };
}

describe('collapseLinearRows', () => {
  it('keeps the mainline, merges and refs but drops interior side-branch commits', () => {
    const rows = [
      row('a', ['b', 'c']),
      row('b', ['d']),
      row('c', ['d']),
      row('d', [])
    ];

    expect(collapseLinearRows(rows).map((item) => item.hash)).toEqual(['a', 'b', 'd']);
  });

  it('keeps a side-branch head that carries a ref', () => {
    const rows = [
      row('a', ['b', 'c']),
      row('b', ['d']),
      row('c', ['d'], ['feature']),
      row('d', [])
    ];

    expect(collapseLinearRows(rows).map((item) => item.hash)).toEqual(['a', 'b', 'c', 'd']);
  });
});
