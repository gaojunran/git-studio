import { useEffect, useRef, useState } from 'react';
import type {
  CommitDetail,
  CommitItemLink,
  CommitRow,
  Filters,
  GraphRow,
  HistoryColumn,
  HostMessage,
  InitState,
  RebasePlan,
  UndoInfo
} from '../shared/protocol';
import { getState, post, setState } from './vscode';
import { Toolbar } from './components/Toolbar';
import { CommitList } from './components/CommitList';
import { DetailPane } from './components/DetailPane';
import { RebaseDialog } from './components/RebaseDialog';

interface PersistedState {
  root: string;
  filters: Filters;
}

const COLUMN_ORDER: HistoryColumn[] = ['graph', 'subject', 'refs', 'author', 'date', 'hash'];

function normalizeColumns(columns: HistoryColumn[] | undefined): HistoryColumn[] {
  const source = columns ?? (['graph', 'subject', 'refs', 'author', 'date'] as HistoryColumn[]);
  return COLUMN_ORDER.filter((column) => source.includes(column));
}

export function App() {
  const [init, setInit] = useState<InitState | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [rows, setRows] = useState<CommitRow[]>([]);
  const [graph, setGraph] = useState<GraphRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoInfo | null>(null);
  const [rebasePlan, setRebasePlan] = useState<RebasePlan | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [commitItems, setCommitItems] = useState<CommitItemLink[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; patch: string; error?: string } | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [focusHash, setFocusHash] = useState<string | null>(null);
  const [columns, setColumns] = useState<HistoryColumn[]>(COLUMN_ORDER);
  const [timeField, setTimeField] = useState<'author' | 'commit'>('author');
  const [allRepos, setAllRepos] = useState(false);

  const pageSizeRef = useRef(500);
  const requestIdRef = useRef(0);
  const latestRequestRef = useRef(0);
  const loadingRef = useRef(false);
  const rowsRef = useRef<CommitRow[]>([]);
  const hasMoreRef = useRef(false);
  const filtersRef = useRef<Filters | null>(null);
  const selectedRef = useRef<string | null>(null);
  const parentIndexRef = useRef(0);
  const repoRootRef = useRef<string | undefined>(undefined);
  const initializedRef = useRef(false);
  const runQueryRef = useRef<(next: Filters, append: boolean) => void>(() => undefined);

  rowsRef.current = rows;
  hasMoreRef.current = hasMore;
  filtersRef.current = filters;
  selectedRef.current = selected;

  const runQuery = (next: Filters, append: boolean) => {
    if (append && (loadingRef.current || !hasMoreRef.current)) {
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    latestRequestRef.current = requestId;
    loadingRef.current = true;
    setError(null);
    post({
      type: 'query',
      requestId,
      append,
      filters: next,
      skip: append ? rowsRef.current.length : 0,
      limit: pageSizeRef.current
    });
  };
  runQueryRef.current = runQuery;

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;

      switch (message.type) {
        case 'init': {
          setInit(message.state);
          setOperation(message.state.operation);
          setUndo(message.state.undo);
          setColumns(normalizeColumns(message.state.columns));
          setTimeField(message.state.timeField);
          setAllRepos(message.state.allRepos);
          pageSizeRef.current = message.state.pageSize;
          const persisted = getState<PersistedState>();
          const usable = !initializedRef.current && persisted && persisted.root === message.state.repo.root
            ? persisted.filters
            : undefined;
          initializedRef.current = true;
          const next = usable ?? message.state.filters;
          setFilters(next);
          break;
        }
        case 'commits': {
          if (message.requestId < latestRequestRef.current) {
            return;
          }
          loadingRef.current = false;
          setRows((previous) => (message.append ? [...previous, ...message.rows] : message.rows));
          setGraph(message.graph);
          setHasMore(message.hasMore);
          setStale(message.stale);
          if (message.append && message.rows.length === 0 && message.hasMore) {
            setTimeout(() => {
              if (filtersRef.current) {
                runQueryRef.current(filtersRef.current, true);
              }
            }, 0);
          }
          break;
        }
        case 'detail': {
          if (message.hash !== selectedRef.current) {
            return;
          }
          setDetail(message.detail);
          setCommitItems([]);
          setDetailError(message.error ?? null);
          setDetailLoading(false);
          break;
        }
        case 'filePreview': {
          setPreview({ path: message.path, patch: message.patch, error: message.error });
          break;
        }
        case 'commitItems': {
          if (message.hash !== selectedRef.current) {
            return;
          }
          setCommitItems(message.items);
          break;
        }
        case 'filters': {
          setFilters(message.filters);
          break;
        }
        case 'focusCommit': {
          setFocusHash(message.hash);
          setSelected(message.hash);
          parentIndexRef.current = 0;
          setDetail(null);
          setDetailLoading(true);
          setDetailError(null);
          post({ type: 'selectCommit', hash: message.hash });
          break;
        }
        case 'busy': {
          setBusy(message.busy);
          if (!message.busy) {
            loadingRef.current = false;
          }
          break;
        }
        case 'operation':
          setOperation(message.operation);
          break;
        case 'undo':
          setUndo(message.undo);
          break;
        case 'rebasePlan':
          setRebasePlan(message.plan);
          break;
        case 'error': {
          setError(message.message);
          if (!message.requestId || message.requestId >= latestRequestRef.current) {
            loadingRef.current = false;
          }
          break;
        }
      }
    };

    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!filters || !init) {
      return;
    }

    setState({ root: init.repo.root, filters } satisfies PersistedState);
    const timer = setTimeout(() => {
      setRows([]);
      setGraph([]);
      setSelected(null);
      setDetail(null);
      setDetailError(null);
      setCompare(null);
      setStale(false);
      loadingRef.current = false;
      runQueryRef.current(filters, false);
    }, 300);

    return () => clearTimeout(timer);
  }, [filters, init]);

  useEffect(() => {
    if (!focusHash) {
      return;
    }
    if (rows.some((row) => row.hash === focusHash)) {
      setFocusHash(null);
      return;
    }
    if (hasMore && !loadingRef.current && filtersRef.current) {
      runQueryRef.current(filtersRef.current, true);
    }
  }, [focusHash, rows, hasMore]);

  const select = (hash: string, parentIndex = 0, repoRoot?: string) => {
    if (selectedRef.current === hash && parentIndexRef.current === parentIndex && repoRootRef.current === repoRoot) {
      return;
    }
    parentIndexRef.current = parentIndex;
    repoRootRef.current = repoRoot;
    setSelected(hash);
    setDetail(null);
    setPreview(null);
    setDetailError(null);
    setDetailLoading(true);
    post({ type: 'selectCommit', hash, parentIndex, ...(repoRoot ? { repoRoot } : {}) });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .splitter')) {
        return;
      }
      const current = selectedRef.current;
      if (!current) {
        return;
      }
      if (event.key === 'ArrowLeft' && detail?.parents[0]) {
        event.preventDefault();
        select(detail.parents[0]);
      } else if (event.key === 'ArrowRight') {
        const child = rows.find((row) => row.parents.includes(current));
        if (child) {
          event.preventDefault();
          select(child.hash);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, detail]);

  const toggleCompare = (hash: string) => {
    setCompare((previous) => (previous === hash ? null : hash));
  };

  const changeFilters = (patch: Partial<Filters>) => {
    setFilters((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const toggleColumn = (column: HistoryColumn) => {
    const next = columns.includes(column)
      ? columns.filter((item) => item !== column)
      : COLUMN_ORDER.filter((item) => item === column || columns.includes(item));
    setColumns(next);
    post({ type: 'setColumns', columns: next });
  };

  const changeTimeField = (field: 'author' | 'commit') => {
    setTimeField(field);
    post({ type: 'setTimeField', field });
  };

  const changeAllRepos = (enabled: boolean) => {
    setAllRepos(enabled);
    post({ type: 'setAllRepos', enabled });
  };

  const resetFilters = () => {
    if (!filters) {
      return;
    }
    changeFilters({
      path: '',
      author: '',
      message: '',
      regex: false,
      caseSensitive: false,
      firstParent: false,
      noMerges: false,
      collapseLinear: false,
      since: '',
      until: '',
      lineRange: undefined,
      order: 'date'
    });
  };

  if (!init || !filters) {
    return <div className="loading-screen">Loading history…</div>;
  }

  return (
    <div className="app">
      <Toolbar
        repo={init.repo}
        refs={init.refs}
        filters={filters}
        columns={columns}
        timeField={timeField}
        allRepos={allRepos}
        repoCount={Math.max(1, init.repos.length)}
        onToggleAllRepos={changeAllRepos}
        onChange={changeFilters}
        onReset={resetFilters}
        onPickRepo={() => post({ type: 'pickerRepo' })}
        onPickRefs={() => post({ type: 'pickerRefs' })}
        onRefresh={() => post({ type: 'refresh' })}
        onUndo={() => post({ type: 'undoLastRewrite' })}
        undo={undo}
        onOpenSettings={() => post({ type: 'openSettings' })}
        onToggleColumn={toggleColumn}
        onTimeField={changeTimeField}
      />

      {busy && <div className="progress" />}

      {error && (
        <div className="banner banner--error">
          <span className="banner__text">{error}</span>
          <button className="btn btn--small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {stale && (
        <div className="banner banner--warning">
          <span className="banner__text">History changed while browsing. The loaded page may be out of date.</span>
          <button className="btn btn--small" onClick={() => post({ type: 'refresh' })}>
            Refresh
          </button>
        </div>
      )}

      {operation && (
        <div className="banner banner--warning">
          <span className="banner__text">
            {operation} in progress — resolve conflicts in Source Control, or abort.
          </span>
          <button className="btn btn--small" onClick={() => post({ type: 'abortOperation' })}>
            Abort {operation}
          </button>
          {operation !== 'merge' && (
            <>
              <button className="btn btn--small" onClick={() => post({ type: 'continueOperation' })}>
                Continue
              </button>
              <button className="btn btn--small" onClick={() => post({ type: 'skipOperation' })}>
                Skip
              </button>
            </>
          )}
        </div>
      )}

      <div className="main">
        <CommitList
          rows={rows}
          graph={graph}
          hasMore={hasMore}
          loading={busy}
          selected={selected}
          compare={compare}
          columns={columns}
          timeField={timeField}
          me={init.me}
          currentBranch={init.currentBranch ?? init.repo.branch}
          unpushed={init.unpushed}
          allRepos={allRepos}
          onSelect={select}
          onToggleCompare={toggleCompare}
          onOpenCommit={(hash) => post({ type: 'openCommitChanges', hash })}
          onActions={(hash) => post({ type: 'commitActions', hash })}
          onLoadMore={() => runQueryRef.current(filters, true)}
        />
        <DetailPane
          detail={detail}
          items={commitItems}
          loading={detailLoading}
          error={detailError}
          preview={preview}
          onClosePreview={() => setPreview(null)}
          selected={selected}
          compare={compare}
          onSelectParent={select}
          onOpenCommit={select}
          onSelectParentIndex={(index) => selected && select(selected, index)}
          onOpenFileDiff={(file) =>
            selected &&
            post({
              type: 'openFileDiff',
              hash: selected,
              path: file.path,
              oldPath: file.oldPath,
              status: file.status
            })
          }
          onFileActions={(file) =>
            selected &&
            post({
              type: 'fileActions',
              hash: selected,
              path: file.path,
              oldPath: file.oldPath,
              status: file.status
            })
          }
          onOpenChanges={() => selected && post({ type: 'openCommitChanges', hash: selected })}
          onCompare={() => selected && compare && post({ type: 'compare', a: compare, b: selected })}
          onActions={() => selected && post({ type: 'commitActions', hash: selected })}
          onCopy={(text) => post({ type: 'copy', text })}
          onOpenBoardItem={(item) => post({ type: 'openBoardItem', ...item })}
        />
      </div>
      <RebaseDialog
        plan={rebasePlan}
        onClose={() => setRebasePlan(null)}
        onStart={(plan) => {
          post({ type: 'startRebase', plan });
          setRebasePlan(null);
        }}
      />
    </div>
  );
}
