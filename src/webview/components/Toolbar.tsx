import { useState } from 'react';
import type { Filters, RefInfo, RepoSummary } from '../../shared/protocol';

interface Props {
  repo: RepoSummary;
  refs: RefInfo[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onPickRepo: () => void;
  onPickRefs: () => void;
  onRefresh: () => void;
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

  const refLabel = filters.refs.length === 0
    ? 'All refs'
    : filters.refs.length === 1
      ? refs.find((ref) => ref.name === filters.refs[0])?.shortName ?? '1 ref'
      : `${filters.refs.length} refs`;

  return (
    <div className="toolbar">
      <div className="toolbar__row">
        <button className="btn btn--repo" onClick={props.onPickRepo} title={repo.root}>
          <span className="btn__label">{repo.name}</span>
          {repo.detached ? <span className="muted">detached</span> : repo.branch ? <span className="muted">{repo.branch}</span> : null}
        </button>

        <button className="btn" onClick={props.onPickRefs} title="Filter by branches and tags">
          {refLabel}
        </button>

        <input
          className="input input--search"
          placeholder="Search commits…"
          value={filters.message}
          onChange={(event) => props.onChange({ message: event.target.value })}
          spellCheck={false}
        />

        <span className="toolbar__spacer" />

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
