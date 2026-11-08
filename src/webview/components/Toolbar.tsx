import { useState } from 'react';
import type { Filters, RefInfo, RepoSummary, UndoInfo } from '../../shared/protocol';

interface Props {
  repo: RepoSummary;
  refs: RefInfo[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onPickRepo: () => void;
  onPickRefs: () => void;
  onRefresh: () => void;
  onUndo: () => void;
  undo: UndoInfo | null;
  onOpenSettings: () => void;
}

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
      filters.order !== 'date'
  );
}

export function Toolbar(props: Props) {
  const { repo, refs, filters } = props;
  const [expanded, setExpanded] = useState(false);
  const linear = filters.noMerges;

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
