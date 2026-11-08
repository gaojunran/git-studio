import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { CommitRow, GraphRow, HistoryColumn } from '../../shared/protocol';
import { GraphOverlay } from './GraphOverlay';
import { formatDateTime, relativeDate } from '../format';

const ROW_HEIGHT = 26;

const REPO_COLORS = ['#7f9cc0', '#a58fb8', '#c2987f', '#8fb39a', '#b08f9c', '#8fa8b3', '#aca98f', '#9b8fc7'];

function repoBadgeStyle(color: number | undefined): CSSProperties {
  const index = Math.abs(color ?? 0) % REPO_COLORS.length;
  return { '--repo-color': REPO_COLORS[index] } as CSSProperties;
}

function isCurrentBranchRow(refs: string[], currentBranch: string | null): boolean {
  return refs.some((ref) => ref.startsWith('HEAD ->') || (currentBranch ? ref === currentBranch : false));
}

function isMine(row: CommitRow, me: { name: string; email: string }): boolean {
  const email = me.email.trim().toLowerCase();
  const name = me.name.trim().toLowerCase();
  return Boolean(
    (email && row.authorEmail.trim().toLowerCase() === email) || (name && row.authorName.trim().toLowerCase() === name)
  );
}

interface Props {
  rows: CommitRow[];
  graph: GraphRow[];
  hasMore: boolean;
  loading: boolean;
  selected: string | null;
  compare: string | null;
  columns: HistoryColumn[];
  timeField: 'author' | 'commit';
  me: { name: string; email: string };
  currentBranch: string | null;
  unpushed: string[];
  allRepos: boolean;
  onSelect: (hash: string, parentIndex?: number, repoRoot?: string) => void;
  onToggleCompare: (hash: string) => void;
  onOpenCommit: (hash: string) => void;
  onActions: (hash: string) => void;
  onLoadMore: () => void;
}

interface RefBadge {
  label: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
}

function refBadges(refs: string[]): RefBadge[] {
  const badges: RefBadge[] = [];
  for (const raw of refs) {
    if (raw.startsWith('HEAD -> ')) {
      badges.push({ label: raw.slice('HEAD -> '.length), kind: 'head' });
    } else if (raw.startsWith('tag: ')) {
      badges.push({ label: raw.slice('tag: '.length), kind: 'tag' });
    } else if (raw.startsWith('HEAD')) {
      badges.push({ label: 'HEAD', kind: 'head' });
    } else if (raw.includes('/')) {
      badges.push({ label: raw, kind: 'remote' });
    } else {
      badges.push({ label: raw, kind: 'local' });
    }
  }
  return badges;
}

export function CommitList(props: Props) {
  const { rows, graph, hasMore, loading, selected, compare, columns, timeField, me, currentBranch, allRepos } = props;
  const columnSet = useMemo(() => new Set(columns), [columns]);
  const unpushedSet = useMemo(() => new Set(props.unpushed), [props.unpushed]);
  const showGraph = columnSet.has('graph') && !allRepos;
  const maxLane = useMemo(() => {
    if (!showGraph) {
      return 0;
    }
    let max = 0;
    for (const row of graph) {
      max = Math.max(max, row.lane);
      for (const segment of row.segments) {
        max = Math.max(max, segment.from, segment.to);
      }
    }
    return max;
  }, [graph, showGraph]);
  const laneGap = maxLane > 14 ? 9 : maxLane > 8 ? 11 : 14;
  const graphWidth = showGraph ? 10 + maxLane * laneGap + 14 : 10;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const frameRef = useRef(0);
  const scrolledForRef = useRef<string | null>(null);
  const loadMoreRef = useRef(props.onLoadMore);
  loadMoreRef.current = props.onLoadMore;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || rows.length === 0 || !hasMore || loading) {
      return;
    }
    if (element.scrollHeight <= element.clientHeight + 1) {
      loadMoreRef.current();
    }
  }, [rows.length, hasMore, loading]);

  useEffect(() => {
    const element = containerRef.current;
    if (element && element.scrollTop > rows.length * ROW_HEIGHT) {
      element.scrollTop = 0;
      setScrollTop(0);
    }
  }, [rows.length]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !selected || scrolledForRef.current === selected) {
      return;
    }
    const index = rows.findIndex((row) => row.hash === selected);
    if (index < 0) {
      return;
    }
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2 + ROW_HEIGHT / 2);
      setScrollTop(element.scrollTop);
    }
    scrolledForRef.current = selected;
  }, [selected, rows]);

  const handleScroll = () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const element = containerRef.current;
      if (!element) {
        return;
      }
      setScrollTop(element.scrollTop);
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 300) {
        props.onLoadMore();
      }
    });
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 8);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      return;
    }
    const index = selected ? rows.findIndex((row) => row.hash === selected) : -1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, index + 1)];
      if (next) {
        props.onSelect(next.hash, 0, next.repoRoot);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.max(0, index - 1)];
      if (next) {
        props.onSelect(next.hash, 0, next.repoRoot);
      }
    } else if (event.key === 'Enter' && selected) {
      event.preventDefault();
      props.onOpenCommit(selected);
    }
  };

  const visible: ReactNode[] = [];
  for (let index = start; index < end; index += 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }
    const badges = refBadges(row.refs);
    const shown = badges.slice(0, 3);
    const hidden = badges.length - shown.length;
    const isSelected = row.hash === selected;
    const isCompare = row.hash === compare;
    const mine = isMine(row, me);
    const onBranch = isCurrentBranchRow(row.refs, currentBranch);
    const merge = row.parents.length > 1;
    const stamp = timeField === 'commit' ? row.commitDate : row.authorDate;
    const notPushed = unpushedSet.has(row.hash);

    visible.push(
      <div
        key={row.hash}
        className={`row ${isSelected ? 'row--selected' : ''} ${isCompare ? 'row--compare' : ''} ${onBranch ? 'row--branch' : ''}`}
        role="option"
        aria-selected={isSelected}
        style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: graphWidth }}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) {
            props.onToggleCompare(row.hash);
          } else {
            props.onSelect(row.hash, 0, row.repoRoot);
          }
        }}
        onDoubleClick={() => props.onOpenCommit(row.hash)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onSelect(row.hash, 0, row.repoRoot);
          props.onActions(row.hash);
        }}
        title={`${row.shortHash} · ${row.authorName} · ${row.subject}`}
      >
        <span className="row__main">
          {allRepos && row.repoName && (
            <span className="repo-badge" style={repoBadgeStyle(row.repoColor)} title={row.repoRoot ?? row.repoName}>
              {row.repoName}
            </span>
          )}
          {columnSet.has('subject') && (
            <span
              className={`row__subject ${mine ? 'row__subject--mine' : ''} ${merge ? 'row__subject--merge' : ''}`}
              title={row.subject || '(no message)'}
            >
              {row.subject || <span className="muted">(no message)</span>}
            </span>
          )}
          {columnSet.has('refs') && shown.length > 0 && (
            <span className="row__refs">
              {shown.map((badge) => (
                <span key={`${row.hash}-${badge.kind}-${badge.label}`} className={`ref ref--${badge.kind}`}>
                  {badge.kind === 'head' ? '⌂ ' : ''}
                  {badge.label}
                </span>
              ))}
              {hidden > 0 && <span className="ref ref--more">+{hidden}</span>}
            </span>
          )}
        </span>
        {columnSet.has('author') && <span className="row__author">{row.authorName}</span>}
        {columnSet.has('date') && (
          <span className="row__date" title={formatDateTime(stamp)}>
            {relativeDate(stamp)}
          </span>
        )}
        {notPushed && <span className="row__unpushed" title="Not pushed" aria-label="Not pushed" />}
        {columnSet.has('hash') && <span className="row__hash">{row.shortHash}</span>}
        {isCompare && <span className="row__anchor">A</span>}
      </div>
    );
  }

  return (
    <div className="list" ref={containerRef} onScroll={handleScroll} tabIndex={0} onKeyDown={handleKeyDown} role="listbox" aria-label="Commits">
      <div className="list__spacer" style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.length > 0 && showGraph && (
          <GraphOverlay
            graph={graph}
            rows={rows}
            startIndex={start}
            endIndex={end}
            rowHeight={ROW_HEIGHT}
            width={graphWidth}
            laneGap={laneGap}
            selectedHash={selected}
          />
        )}
        {visible}
      </div>

      {rows.length === 0 && !loading && (
        <div className="list__empty">No commits match the current filters.</div>
      )}
      {hasMore && !loading && (
        <div className="list__more">
          <button className="btn btn--small" onClick={() => loadMoreRef.current()}>
            Load more
          </button>
        </div>
      )}
      {loading && <div className="list__status">Loading…</div>}
      {!loading && !hasMore && rows.length > 0 && <div className="list__status">End of history</div>}
    </div>
  );
}
