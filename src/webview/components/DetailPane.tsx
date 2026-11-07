import { useEffect, useState } from 'react';
import type { CommitDetail, FileChange } from '../../shared/protocol';
import { formatDateTime } from '../format';

interface Props {
  detail: CommitDetail | null;
  loading: boolean;
  error: string | null;
  selected: string | null;
  compare: string | null;
  onSelectParent: (hash: string) => void;
  onSelectParentIndex: (index: number) => void;
  onOpenFileDiff: (file: FileChange) => void;
  onOpenFileHistory: (filePath: string) => void;
  onOpenFileAtRevision: (filePath: string) => void;
  onOpenChanges: () => void;
  onCompare: () => void;
  onActions: () => void;
  onCopy: (text: string) => void;
}

function statusClass(status: FileChange['status']): string {
  switch (status) {
    case 'A':
      return 'file__status file__status--added';
    case 'D':
      return 'file__status file__status--deleted';
    case 'R':
    case 'C':
      return 'file__status file__status--renamed';
    case 'U':
      return 'file__status file__status--conflict';
    default:
      return 'file__status file__status--modified';
  }
}

function splitPath(filePath: string): { directory: string; name: string } {
  const index = filePath.lastIndexOf('/');
  return index === -1
    ? { directory: '', name: filePath }
    : { directory: filePath.slice(0, index + 1), name: filePath.slice(index + 1) };
}

export function DetailPane(props: Props) {
  const { detail, loading, error, selected, compare } = props;
  const [expanded, setExpanded] = useState(false);
  const [fileQuery, setFileQuery] = useState('');

  useEffect(() => {
    setExpanded(false);
    setFileQuery('');
  }, [detail?.hash, detail?.parentIndex]);

  if (!selected) {
    return (
      <div className="detail detail--empty">
        <span>Select a commit to inspect it.</span>
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="detail detail--empty">
        <span>Loading commit…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="detail detail--empty">
        <span className="error-text">{error}</span>
      </div>
    );
  }

  if (!detail) {
    return <div className="detail detail--empty" />;
  }

  const lines = detail.message.split('\n');
  const subject = lines[0] ?? '';
  const body = lines.slice(1).join('\n').trim();
  const files = fileQuery
    ? detail.files.filter((file) => file.path.toLowerCase().includes(fileQuery.toLowerCase()))
    : detail.files;

  return (
    <div className="detail">
      <div className="detail__header">
        <span className="mono detail__hash">{detail.hash.slice(0, 10)}</span>
        <button className="btn btn--small" onClick={() => props.onCopy(detail.hash)}>
          Copy
        </button>
      </div>

      <div className="detail__subject">{subject}</div>
      {body && (
        <div className={`detail__body ${expanded ? 'detail__body--expanded' : ''}`}>
          <pre>{body}</pre>
          {!expanded && body.length > 400 && (
            <button className="btn btn--link" onClick={() => setExpanded(true)}>
              Show more
            </button>
          )}
        </div>
      )}

      <dl className="meta">
        <dt>Author</dt>
        <dd>
          {detail.authorName} <span className="muted">&lt;{detail.authorEmail}&gt;</span>
        </dd>
        <dt>Date</dt>
        <dd>{formatDateTime(detail.authorDate)}</dd>
        <dt>Committer</dt>
        <dd>
          {detail.committerName} <span className="muted">{formatDateTime(detail.commitDate)}</span>
        </dd>
        <dt>Parents</dt>
        <dd className="meta__parents">
          {detail.parents.length === 0 && <span className="muted">root commit</span>}
          {detail.parents.map((parent) => (
            <button key={parent} className="btn btn--link mono" onClick={() => props.onSelectParent(parent)}>
              {parent.slice(0, 8)}
            </button>
          ))}
        </dd>
      </dl>

      <div className="detail__files-header">
        <span>
          {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="diffstat">
          <span className="diffstat__add">+{detail.additions}</span>
          <span className="diffstat__del">−{detail.deletions}</span>
        </span>
      </div>

      {detail.parents.length > 1 && (
        <div className="parents-toggle">
          <span className="muted">Diff against</span>
          {detail.parents.map((parent, index) => (
            <button
              key={parent}
              className={`btn btn--small ${index === detail.parentIndex ? 'btn--active' : ''}`}
              onClick={() => props.onSelectParentIndex(index)}
            >
              parent {index + 1} ({parent.slice(0, 7)})
            </button>
          ))}
        </div>
      )}

      {detail.files.length > 8 && (
        <input
          className="input detail__filter"
          placeholder="Filter files…"
          value={fileQuery}
          onChange={(event) => setFileQuery(event.target.value)}
          spellCheck={false}
        />
      )}

      <div className="files">
        {files.map((file) => {
          const parts = splitPath(file.path);
          return (
            <div
              key={`${file.status}-${file.path}`}
              className="file"
              onClick={() => props.onOpenFileDiff(file)}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <span className={statusClass(file.status)}>{file.status}</span>
              <span className="file__path">
                <span className="muted">{parts.directory}</span>
                {parts.name}
              </span>
              <span className="file__stat">
                {file.binary ? (
                  <span className="muted">bin</span>
                ) : (
                  <>
                    {file.additions > 0 && <span className="diffstat__add">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="diffstat__del">−{file.deletions}</span>}
                  </>
                )}
              </span>
              <span className="file__actions">
                <button
                  className="btn btn--icon btn--tiny"
                  title="File history"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenFileHistory(file.path);
                  }}
                >
                  ⧖
                </button>
                <button
                  className="btn btn--icon btn--tiny"
                  title="Open at this revision"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenFileAtRevision(file.path);
                  }}
                >
                  ↗
                </button>
              </span>
            </div>
          );
        })}
        {files.length === 0 && <div className="muted files__empty">No files match.</div>}
      </div>

      <div className="detail__footer">
        <button className="btn" onClick={props.onOpenChanges}>
          Open Changes
        </button>
        <button
          className="btn"
          onClick={props.onCompare}
          disabled={!compare || compare === selected}
          title={compare ? `Compare ${compare.slice(0, 8)} with ${selected.slice(0, 8)}` : 'Ctrl/Cmd-click a commit to set the compare base'}
        >
          {compare && compare !== selected ? `Compare ${compare.slice(0, 7)} ↔ ${selected.slice(0, 7)}` : 'Compare'}
        </button>
        <button className="btn btn--actions" onClick={props.onActions} title="More commit actions">
          ⋯
        </button>
      </div>
    </div>
  );
}
