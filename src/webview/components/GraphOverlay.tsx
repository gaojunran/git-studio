import type { ReactNode } from 'react';
import type { GraphRow } from '../../shared/protocol';

const PALETTE = [
  '#e2a03f',
  '#4f9ee8',
  '#57b26b',
  '#d06868',
  '#a97bd6',
  '#d47fb3',
  '#3fb0a4',
  '#c0a24a',
  '#7f8fe0',
  '#8fbf5a'
];

export function graphColor(color: number): string {
  return PALETTE[((color % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

interface Props {
  graph: GraphRow[];
  startIndex: number;
  endIndex: number;
  rowHeight: number;
  width: number;
  laneGap: number;
  selectedHash: string | null;
  rows: { hash: string }[];
}

function laneX(lane: number, gap: number): number {
  return 10 + lane * gap;
}

export function GraphOverlay(props: Props) {
  const { graph, startIndex, endIndex, rowHeight, width, laneGap, selectedHash, rows } = props;
  const height = Math.max(0, endIndex - startIndex) * rowHeight;
  const nodes: ReactNode[] = [];
  const paths: ReactNode[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const row = graph[index];
    const commit = rows[index];
    if (!row || !commit) {
      continue;
    }

    const centerY = (index - startIndex) * rowHeight + rowHeight / 2;
    const x = laneX(row.lane, laneGap);

    for (const segment of row.segments) {
      const x0 = laneX(segment.from, laneGap);
      const x1 = laneX(segment.to, laneGap);
      const y0 = centerY;
      const y1 = centerY + rowHeight;
      const path = segment.from === segment.to
        ? `M ${x0} ${y0} L ${x1} ${y1}`
        : `M ${x0} ${y0} C ${x0} ${y0 + rowHeight * 0.35}, ${x1} ${y1 - rowHeight * 0.35}, ${x1} ${y1}`;
      paths.push(
        <path
          key={`s-${index}-${segment.from}-${segment.to}`}
          d={path}
          stroke={graphColor(segment.color)}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    const selected = commit.hash === selectedHash;
    nodes.push(
      <circle
        key={`n-${index}`}
        cx={x}
        cy={centerY}
        r={selected ? 4.5 : 3.5}
        fill={graphColor(row.color)}
        stroke={selected ? 'var(--vscode-editor-background)' : 'none'}
        strokeWidth={selected ? 1.5 : 0}
      />
    );
  }

  return (
    <svg className="graph" width={width} height={height} aria-hidden="true">
      {paths}
      {nodes}
    </svg>
  );
}
