import type { CommitRow, GraphRow, GraphSegment } from '../../shared/protocol';

interface Lane {
  hash: string;
  color: number;
}

export function layoutGraph(rows: Pick<CommitRow, 'hash' | 'parents'>[]): GraphRow[] {
  const lanes: (Lane | null)[] = [];
  let nextColor = 0;
  const result: GraphRow[] = [];

  for (const row of rows) {
    let lane = lanes.findIndex((entry) => entry?.hash === row.hash);
    if (lane === -1) {
      lane = lanes.findIndex((entry) => entry === null);
      const entry: Lane = { hash: row.hash, color: nextColor++ };
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(entry);
      } else {
        lanes[lane] = entry;
      }
    }

    const node = lanes[lane];
    if (!node) {
      continue;
    }

    const before = lanes.map((entry) => (entry ? { ...entry } : null));
    const parents = row.parents;
    const firstParent = parents[0];

    if (firstParent) {
      const existing = lanes.findIndex((entry, index) => index !== lane && entry?.hash === firstParent);
      lanes[lane] = existing === -1 ? { hash: firstParent, color: node.color } : null;
    } else {
      lanes[lane] = null;
    }

    for (const parent of parents.slice(1)) {
      if (lanes.some((entry) => entry?.hash === parent)) {
        continue;
      }
      const free = lanes.findIndex((entry) => entry === null);
      const entry: Lane = { hash: parent, color: nextColor++ };
      if (free === -1) {
        lanes.push(entry);
      } else {
        lanes[free] = entry;
      }
    }

    const segments: GraphSegment[] = [];
    const addSegment = (from: number, to: number, color: number) => {
      if (segments.some((segment) => segment.from === from && segment.to === to)) {
        return;
      }
      segments.push({ from, to, color });
    };

    for (let index = 0; index < before.length; index += 1) {
      const entry = before[index];
      if (entry && entry.hash !== row.hash) {
        addSegment(index, index, entry.color);
      }
    }

    for (const parent of parents) {
      const target = lanes.findIndex((entry) => entry?.hash === parent);
      if (target !== -1) {
        addSegment(lane, target, lanes[target]?.color ?? node.color);
      }
    }

    segments.sort((a, b) => a.from - b.from || a.to - b.to);
    result.push({ lane, color: node.color, segments });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
  }

  return result;
}
