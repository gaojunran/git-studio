import { useEffect, useMemo, useRef, useState } from 'react';
import type { SidebarFile, SidebarState } from '../shared/sidebar';
import { getState, onMessage, post, setState } from './bridge';

type Group = 'conflicts' | 'staged' | 'changes' | 'untracked';

interface Persisted {
  repo?: string;
  message?: string;
}

const GROUP_LABEL: Record<Group, string> = {
  conflicts: 'Conflicts',
  staged: 'Staged',
  changes: 'Changes',
  untracked: 'Untracked'
};

function statusClass(file: SidebarFile): string {
  if (file.conflict) {
    return 'status status--conflict';
  }
  if (file.status === 'A' || file.status === '?') {
    return 'status status--added';
  }
  if (file.status === 'D') {
    return 'status status--deleted';
  }
  return 'status status--modified';
}

function splitPath(value: string): { directory: string; name: string } {
  const index = value.lastIndexOf('/');
  return index < 0
    ? { directory: '', name: value }
    : { directory: `${value.slice(0, index + 1)}`, name: value.slice(index + 1) };
}

function groupFiles(files: SidebarFile[], group: Group): SidebarFile[] {
  switch (group) {
    case 'conflicts':
      return files.filter((file) => file.conflict);
    case 'staged':
      return files.filter((file) => file.staged && !file.conflict);
    case 'changes':
      return files.filter((file) => file.unstaged && !file.conflict && file.status !== '?');
    case 'untracked':
      return files.filter((file) => file.status === '?');
  }
}

export function App() {
  const [state, setLocalState] = useState<SidebarState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<Group>>(new Set());
  const [menu, setMenu] = useState<'commit' | 'branch' | 'stash' | null>(null);
  const [commitMode, setCommitMode] = useState<'staged' | 'all'>('staged');
  const [amend, setAmend] = useState(false);
  const [push, setPush] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    const persisted = getState<Persisted>();
    if (persisted?.message) {
      setMessage(persisted.message);
    }
    post({ type: 'ready' });
    onMessage((incoming) => {
      switch (incoming.type) {
        case 'state':
          setLocalState(incoming.state);
          readyRef.current = true;
          setMessage((current) => (current ? current : incoming.state.commitMessage));
          break;
        case 'busy':
          setBusy(incoming.busy);
          break;
        case 'error':
          setError(incoming.message);
          break;
        case 'toast':
          setToast(incoming.message);
          setTimeout(() => setToast(null), 1800);
          break;
      }
    });
  }, []);

  useEffect(() => {
    if (readyRef.current) {
      setState({ message } satisfies Persisted);
    }
  }, [message]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  const groups = useMemo(() => {
    const files = state?.files ?? [];
    return {
      conflicts: groupFiles(files, 'conflicts'),
      staged: groupFiles(files, 'staged'),
      changes: groupFiles(files, 'changes'),
      untracked: groupFiles(files, 'untracked')
    };
  }, [state]);

  const toggleGroup = (group: Group) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const toggleFile = (group: Group, file: SidebarFile, additive: boolean) => {
    const key = `${group}:${file.path}`;
    setSelected((previous) => {
      const next = additive ? new Set(previous) : new Set<string>();
      if (previous.has(key) && additive) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const pathsOf = (group: Group, groupFilesList: SidebarFile[]): string[] => {
    const chosen = groupFilesList.filter((file) => selected.has(`${group}:${file.path}`));
    const source = chosen.length > 0 ? chosen : groupFilesList;
    return source.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path]));
  };

  const stage = (group: Group, files: SidebarFile[]) => post({ type: 'stage', paths: pathsOf(group, files) });
  const unstage = (group: Group, files: SidebarFile[]) => post({ type: 'unstage', paths: pathsOf(group, files) });
  const discard = (group: Group, files: SidebarFile[]) => post({ type: 'discard', paths: pathsOf(group, files) });

  const renderGroup = (group: Group, list: SidebarFile[], actions: 'stage' | 'unstage' | 'discard' | 'none') => {
    if (list.length === 0) {
      return null;
    }
    const isCollapsed = collapsed.has(group);
    return (
      <section className="group" key={group}>
        <div className="group__head">
          <button className="group__title" onClick={() => toggleGroup(group)} title={isCollapsed ? 'Expand' : 'Collapse'}>
            <span className="group__chevron">{isCollapsed ? '▸' : '▾'}</span>
            {GROUP_LABEL[group]}
            <span className="group__count">{list.length}</span>
          </button>
          <span className="group__actions">
            {actions === 'stage' && (
              <button className="icon" title="Stage all" onClick={() => post({ type: group === 'changes' ? 'stageAll' : 'stage', paths: list.map((file) => file.path) })}>
                ＋
              </button>
            )}
            {actions === 'unstage' && (
              <button className="icon" title="Unstage all" onClick={() => post({ type: 'unstageAll' })}>
                －
              </button>
            )}
            {(actions === 'stage' || actions === 'unstage') && (
              <button className="icon" title="Discard all in group" onClick={() => discard(group, list)}>
                ⟲
              </button>
            )}
          </span>
        </div>
        {!isCollapsed && (
          <div className="group__files">
            {list.map((file) => {
              const parts = splitPath(file.path);
              const key = `${group}:${file.path}`;
              return (
                <div
                  key={key}
                  className={`file ${selected.has(key) ? 'file--selected' : ''}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      toggleFile(group, file, true);
                    } else {
                      setSelected(new Set());
                      if (file.status === '?') {
                        post({ type: 'openFile', path: file.path });
                      } else {
                        post({ type: 'openDiff', path: file.path, staged: group === 'staged', conflict: file.conflict });
                      }
                    }
                  }}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                >
                  <span className={statusClass(file)}>{file.conflict ? 'U' : file.status}</span>
                  <span className="file__path">
                    <span className="muted">{parts.directory}</span>
                    {parts.name}
                  </span>
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span className="file__stat">
                      {file.additions > 0 && <span className="stat--add">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="stat--del">−{file.deletions}</span>}
                    </span>
                  )}
                  <span className="file__actions">
                    {(group === 'changes' || group === 'untracked') && (
                      <button
                        className="icon"
                        title="Stage"
                        onClick={(event) => {
                          event.stopPropagation();
                          stage(group, [file]);
                        }}
                      >
                        ＋
                      </button>
                    )}
                    {(group === 'staged' || group === 'conflicts') && (
                      <button
                        className="icon"
                        title={group === 'conflicts' ? 'Mark resolved' : 'Unstage'}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (group === 'conflicts') {
                            post({ type: 'stage', paths: [file.path] });
                          } else {
                            unstage(group, [file]);
                          }
                        }}
                      >
                        {group === 'conflicts' ? '✓' : '－'}
                      </button>
                    )}
                    <button
                      className="icon"
                      title="Discard"
                      onClick={(event) => {
                        event.stopPropagation();
                        discard(group, [file]);
                      }}
                    >
                      ⟲
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  if (!state) {
    return <div className="empty">Loading…</div>;
  }

  const branchLabel = state.detached ? 'detached' : state.branch ?? 'HEAD';

  return (
    <div className="app">
      {busy && <div className="progress" />}

      <header className="header">
        <div className="header__row">
          <select
            className="repo"
            value={state.repo.root}
            onChange={(event) => post({ type: 'selectRepo', root: event.target.value })}
            title={state.repo.root}
          >
            {state.repos.map((repo) => (
              <option key={repo.root} value={repo.root}>
                {repo.name}
              </option>
            ))}
          </select>
          <button className="branch" onClick={() => post({ type: 'pickBranch' })} title="Switch branch">
            <span className="branch__name">{branchLabel}</span>
            {state.ahead > 0 && <span className="ahead">↑{state.ahead}</span>}
            {state.behind > 0 && <span className="behind">↓{state.behind}</span>}
          </button>
          <div className="menu-anchor" ref={menu === 'branch' ? menuRef : undefined}>
            <button className="icon" title="Branch actions" onClick={() => setMenu(menu === 'branch' ? null : 'branch')}>
              ⋯
            </button>
            {menu === 'branch' && (
              <div className="menu">
                <button onClick={() => { setMenu(null); post({ type: 'createBranch' }); }}>Create Branch…</button>
                <button onClick={() => { setMenu(null); post({ type: 'renameBranch' }); }}>Rename Current Branch…</button>
                <button onClick={() => { setMenu(null); post({ type: 'deleteBranch' }); }}>Delete Branch…</button>
                <hr />
                <button onClick={() => { setMenu(null); post({ type: 'openHistory' }); }}>Open History</button>
                <button onClick={() => { setMenu(null); post({ type: 'openBoard' }); }}>Open Issues &amp; PRs</button>
              </div>
            )}
          </div>
        </div>

        <div className="header__row header__sync">
          <button className="btn" onClick={() => post({ type: 'sync', action: 'fetch' })}>Fetch</button>
          <button className="btn" onClick={() => post({ type: 'sync', action: 'pull' })}>Pull</button>
          <button className="btn" onClick={() => post({ type: 'sync', action: 'push' })}>Push</button>
          {!state.upstream && (
            <button className="btn btn--primary" onClick={() => post({ type: 'sync', action: 'publish' })}>
              Publish
            </button>
          )}
        </div>
      </header>

      {state.operation && (
        <div className="banner banner--warning">
          <span>{state.operation.kind} in progress</span>
          <span className="banner__actions">
            {state.operation.canContinue && (
              <button className="btn btn--small" onClick={() => post({ type: 'operation', action: 'continue' })}>Continue</button>
            )}
            {state.operation.canSkip && (
              <button className="btn btn--small" onClick={() => post({ type: 'operation', action: 'skip' })}>Skip</button>
            )}
            <button className="btn btn--small" onClick={() => post({ type: 'operation', action: 'abort' })}>Abort</button>
          </span>
        </div>
      )}

      {error && (
        <div className="banner banner--error">
          <span className="banner__text">{error}</span>
          <button className="icon" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="composer">
        <textarea
          className="composer__input"
          placeholder={`Message (${commitMode === 'all' ? 'commit all' : 'commit staged'})`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              post({ type: 'commit', message, mode: commitMode, amend, push });
            }
          }}
          rows={3}
        />
        <div className="composer__actions">
          <button
            className="btn btn--primary composer__commit"
            disabled={busy || !message.trim() || groups.conflicts.length > 0}
            onClick={() => post({ type: 'commit', message, mode: commitMode, amend, push })}
          >
            {amend ? 'Amend' : 'Commit'} {commitMode === 'all' ? 'All' : 'Staged'}
          </button>
          <div className="menu-anchor" ref={menu === 'commit' ? menuRef : undefined}>
            <button className="btn composer__more" onClick={() => setMenu(menu === 'commit' ? null : 'commit')}>▾</button>
            {menu === 'commit' && (
              <div className="menu menu--right">
                <label className="menu__check">
                  <input type="checkbox" checked={commitMode === 'all'} onChange={(event) => setCommitMode(event.target.checked ? 'all' : 'staged')} />
                  Commit all changes
                </label>
                <label className="menu__check">
                  <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
                  Amend last commit
                </label>
                <label className="menu__check">
                  <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} />
                  Push after commit
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="changes">
        {renderGroup('conflicts', groups.conflicts, 'none')}
        {renderGroup('staged', groups.staged, 'unstage')}
        {renderGroup('changes', groups.changes, 'stage')}
        {renderGroup('untracked', groups.untracked, 'stage')}
        {groups.conflicts.length + groups.staged.length + groups.changes.length + groups.untracked.length === 0 && (
          <div className="empty">No changes</div>
        )}
      </div>

      <footer className="footer">
        <div className="menu-anchor" ref={menu === 'stash' ? menuRef : undefined}>
          <button className="btn btn--small" onClick={() => setMenu(menu === 'stash' ? null : 'stash')}>Stash ▾</button>
          {menu === 'stash' && (
            <div className="menu menu--up">
              <button onClick={() => { setMenu(null); post({ type: 'stash', mode: 'all' }); }}>Stash All</button>
              <button onClick={() => { setMenu(null); post({ type: 'stash', mode: 'staged' }); }}>Stash Staged</button>
              <button onClick={() => { setMenu(null); post({ type: 'stash', mode: 'untracked' }); }}>Stash Untracked</button>
            </div>
          )}
        </div>
        <button className="btn btn--small" onClick={() => post({ type: 'openStashes' })}>Stashes…</button>
        <button className="btn btn--small" onClick={() => post({ type: 'openWorktrees' })}>Worktrees…</button>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
