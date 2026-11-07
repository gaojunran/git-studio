import { describe, expect, it } from 'vitest';
import { layoutGraph } from './layout';

describe('layoutGraph', () => {
  it('lays out linear history in a single lane', () => {
    const rows = layoutGraph([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c'] },
      { hash: 'c', parents: [] }
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.color)).toEqual([0, 0, 0]);
    expect(rows[0].segments).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[1].segments).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[2].segments).toEqual([]);
  });

  it('assigns a second lane for a merge parent and reuses an existing lane', () => {
    const rows = layoutGraph([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c', 'd'] },
      { hash: 'c', parents: ['d'] },
      { hash: 'd', parents: [] }
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 1]);
    expect(rows[1].segments).toContainEqual({ from: 0, to: 1, color: 1 });
    expect(rows[2].segments).toContainEqual({ from: 0, to: 1, color: 1 });
    expect(rows[2].segments).toContainEqual({ from: 1, to: 1, color: 1 });
    expect(rows[3].lane).toBe(1);
  });

  it('does not duplicate a parent that is already tracked', () => {
    const rows = layoutGraph([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c', 'd'] },
      { hash: 'c', parents: ['d'] },
      { hash: 'd', parents: ['e'] },
      { hash: 'e', parents: [] }
    ]);

    const targets = rows.flatMap((row) => row.segments.map((segment) => segment.to));
    expect(targets.length).toBeGreaterThan(0);
    expect(rows[4].lane).toBe(1);
    expect(rows[3].segments).toEqual([{ from: 1, to: 1, color: 1 }]);
    expect(rows[4].segments).toEqual([]);
  });

  it('keeps colors stable across a branch', () => {
    const rows = layoutGraph([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c'] },
      { hash: 'c', parents: [] }
    ]);

    expect(new Set(rows.map((row) => row.color)).size).toBe(1);
  });

  it('handles missing parents and disconnected roots', () => {
    const missing = layoutGraph([{ hash: 'a', parents: ['gone'] }]);
    expect(missing[0].segments).toEqual([{ from: 0, to: 0, color: 0 }]);

    const roots = layoutGraph([
      { hash: 'a', parents: [] },
      { hash: 'b', parents: [] }
    ]);
    expect(roots.map((row) => row.lane)).toEqual([0, 0]);
    expect(roots[1].color).toBe(1);
  });
});
