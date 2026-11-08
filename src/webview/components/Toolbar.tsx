import { useEffect, useRef, useState } from 'react';
import type { Filters, HistoryColumn, RefInfo, RepoSummary, UndoInfo } from '../../shared/protocol';

interface Props {
  repo: RepoSummary;
  refs: RefInfo[];
  filters: Filters;
  columns: HistoryColumn[];
  timeField: 'author' | 'commit';
  allRepos: boolean;
  repoCount: number;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onPickRepo: () => void;
  onToggleAllRepos: (enabled: boolean) => void;
  onPickRefs: () => void;
  onRefresh: () => void;
  onUndo: () => void;
  undo: UndoInfo | null;
  onOpenSettings: () => void;
  onToggleColumn: (column: HistoryColumn) => void;
  onTimeField: (field: 'author' | 'commit') => void;
}

const COLUMNS: { id: HistoryColumn; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'subject', label: 'Subject' },
  { id: 'refs', label: 'Refs' },
  { id: 'author', label: 'Author' },
  { id: 'date', label: 'Date' },
  { id: 'hash', label: 'Hash' }
];

function hasAdvancedFilters(filters: Filters): boolean {
  return Boolean(
    filters.path ||
      filters.author ||
      filters.since ||
      filters.until ||
      filters.regex ||
      filters.caseSensitive ||
      filters.firstParent ||
      filters.noMerges ||
      filters.lineRange ||
      filters.order !== 'date'
  );
}

export function Toolbar(props: Props) {
  const { repo, refs, filters } = props;
  const [expanded, setExpanded] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const linear = filters.noMerges;

  useEffect(() => {
    if (!columnsOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!columnsRef.current?.contains(event.target as Node)) {
        setColumnsOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setColumnsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  const selectedNames = filters.refs.map((name) =>
    refs.find((ref) => ref.name === name)?.shortName ??
    (name === 'HEAD' ? 'HEAD' : name.replace(/^refs\/(heads|remotes|tags)\//, ''))
  );
  const refLabel = filters.refs.length === 0
    ? 'All refs'
    : selectedNames.length <= 3
      ? selectedNames.join(', ')
      : `${filters.refs.length} refs`;
  const refTitle = filters.refs.length === 0
    ? 'Showing all refs — click to choose'
    : `Showing: ${selectedNames.slice(0, 20).join(', ')}${selectedNames.length > 20 ? ` +${selectedNames.length - 20}` : ''}`;

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <button className="btn btn--repo" onClick={props.onPickRepo} title={repo.root}>
          <span className="btn__label">{repo.name}</span>
          {repo.detached ? <span className="muted">detached</span> : repo.branch ? <span className="muted">{repo.branch}</span> : null}
        </button>

        <button
          className={`btn ${props.allRepos ? 'btn--active' : ''}`}
          onClick={() => props.onToggleAllRepos(!props.allRepos)}
          title={
            props.allRepos
              ? `Showing commits from ${props.repoCount} repositories — click to show only ${repo.name}`
              : 'Show commits from every repository in this workspace'
          }
        >
          All repos
        </button>

        <button className="btn" onClick={props.onPickRefs} title={refTitle}>
          {refLabel}
        </button>

        <input
          className="input input--search"
          placeholder="Search commits… (author:, path:, is:merge)"
          title="Search syntax: author:, path:, since:, until:, is:merge, is:no-merge, hash:, regex:true, case:true"
          value={filters.message}
          onChange={(event) => props.onChange({ message: event.target.value })}
          spellCheck={false}
        />

        <span className="toolbar__spacer" />

        <button
          className={`btn ${linear ? 'btn--active' : ''}`}
          onClick={() => props.onChange(linear ? { noMerges: false } : { noMerges: true, firstParent: false })}
          title="Hide merge commits and show only the commits that carry changes"
        >
          Linear
        </button>
        <button
          className={`btn ${filters.collapseLinear ? 'btn--active' : ''}`}
          onClick={() => props.onChange({ collapseLinear: !filters.collapseLinear })}
          title="Collapse linear side branches to their merge points and refs"
        >
          Collapse
        </button>
        <button
          className={`btn ${expanded || hasAdvancedFilters(filters) ? 'btn--active' : ''}`}
          onClick={() => setExpanded((value) => !value)}
          title="Toggle filters"
        >
          Filters
        </button>
        <div className="menu-anchor" ref={columnsRef}>
          <button
            className={`btn ${columnsOpen ? 'btn--active' : ''}`}
            onClick={() => setColumnsOpen((value) => !value)}
            title="Choose visible columns"
            aria-haspopup="dialog"
            aria-expanded={columnsOpen}
          >
            Columns
          </button>
          {columnsOpen && (
            <div className="popover columns-popover" role="dialog" aria-label="Columns">
              <div className="popover__title">Columns</div>
              {COLUMNS.map((column) => (
                <div className="columns-popover__row" key={column.id}>
                  <label className="check columns-popover__check">
                    <input
                      type="checkbox"
                      checked={props.columns.includes(column.id)}
                      onChange={() => props.onToggleColumn(column.id)}
                    />
                    {column.label}
                  </label>
                  {column.id === 'date' && (
                    <span className="time-toggle" role="group" aria-label="Date source">
                      <button
                        className={`time-toggle__btn ${props.timeField === 'author' ? 'time-toggle__btn--on' : ''}`}
                        onClick={() => props.onTimeField('author')}
                        title="Show author time"
                      >
                        Author
                      </button>
                      <button
                        className={`time-toggle__btn ${props.timeField === 'commit' ? 'time-toggle__btn--on' : ''}`}
                        onClick={() => props.onTimeField('commit')}
                        title="Show commit time"
                      >
                        Commit
                      </button>
                    </span>
                  )}
                </div>
              ))}
              <div className="popover__hint">Fixed order: graph → subject → refs → author → date → hash</div>
            </div>
          )}
        </div>
        <button className="btn btn--icon" onClick={props.onRefresh} title="Refresh">
          ⟳
        </button>
        {props.undo && (
          <button
            className="btn"
            onClick={props.onUndo}
            title={`Undo ${props.undo.label} — reset ${props.undo.branch ?? 'HEAD'} to ${props.undo.before.slice(0, 7)}`}
          >
            ↶ Undo
          </button>
        )}
        <button className="btn btn--icon" onClick={props.onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>

      {expanded && (
        <div className="toolbar__filters">
          <label className="field">
            <span className="field__label">Author</span>
            <input
              className="input"
              value={filters.author}
              placeholder="name or email"
              onChange={(event) => props.onChange({ author: event.target.value })}
              spellCheck={false}
            />
          </label>

          <label className="field field--wide">
            <span className="field__label">Path</span>
            <input
              className="input"
              value={filters.path}
              placeholder="src/ or src/file.ts"
              onChange={(event) => props.onChange({ path: event.target.value })}
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span className="field__label">Since</span>
            <input
              className="input"
              type="date"
              value={filters.since}
              onChange={(event) => props.onChange({ since: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field__label">Until</span>
            <input
              className="input"
              type="date"
              value={filters.until}
              onChange={(event) => props.onChange({ until: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="field__label">Lines</span>
            <input
              className="input"
              value={filters.lineRange ?? ''}
              placeholder="10,20"
              onChange={(event) => props.onChange({ lineRange: event.target.value || undefined })}
              spellCheck={false}
            />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={filters.regex}
              onChange={(event) => props.onChange({ regex: event.target.checked })}
            />
            Regex
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={filters.caseSensitive}
              onChange={(event) => props.onChange({ caseSensitive: event.target.checked })}
            />
            Case sensitive
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={filters.firstParent}
              onChange={(event) => props.onChange({ firstParent: event.target.checked })}
            />
            First parent
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={filters.noMerges}
              onChange={(event) => props.onChange({ noMerges: event.target.checked })}
            />
            No merges
          </label>

          <label className="field">
            <span className="field__label">Order</span>
            <select
              className="input"
              value={filters.order}
              onChange={(event) => props.onChange({ order: event.target.value as Filters['order'] })}
            >
              <option value="date">Date</option>
              <option value="topo">Topology</option>
            </select>
          </label>

          <button className="btn btn--small" onClick={props.onReset}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
