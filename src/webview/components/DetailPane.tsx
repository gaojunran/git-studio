import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CommitDetail, CommitItemLink, FileChange } from '../../shared/protocol';
import { formatDateTime } from '../format';

interface Props {
  detail: CommitDetail | null;
  items: CommitItemLink[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  compare: string | null;
  onSelectParent: (hash: string) => void;
  onOpenCommit: (hash: string) => void;
  onSelectParentIndex: (index: number) => void;
  onOpenFileDiff: (file: FileChange) => void;
  onOpenFileWithLocal: (file: FileChange, before: boolean) => void;
  onOpenFileHistory: (filePath: string) => void;
  onOpenFileAtRevision: (filePath: string) => void;
  onOpenChanges: () => void;
  onCompare: () => void;
  onActions: () => void;
  onCopy: (text: string) => void;
  onOpenBoardItem: (item: { providerId?: string; kind: 'issue' | 'pull' | 'discussion'; number: number }) => void;
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

interface MessageLink {
  key: string;
  kind: 'issue' | 'pull';
  number: number;
  label: string;
  providerId?: string;
}

export function messageLinks(message: string, items: CommitItemLink[]): MessageLink[] {
  const links: MessageLink[] = [];
  const seen = new Set<string>();
  const add = (kind: 'issue' | 'pull', number: number, label: string, providerId?: string) => {
    const key = `${kind}-${number}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    links.push({ key, kind, number, label, providerId });
  };

  for (const item of items) {
    if (item.kind !== 'discussion') {
      add(item.kind, item.number, `${item.providerLabel} ${item.kind === 'pull' ? '!' : '#'}${item.number}`, item.providerId);
    }
  }

  const urlPattern = /https?:\/\/[^\s)]+?\/(?:pull|issues|merge_requests|-\/merge_requests)\/(\d+)/gi;
  for (const match of message.matchAll(urlPattern)) {
    const kind = /\/(?:pull|merge_requests|-\/merge_requests)\//i.test(match[0]) ? 'pull' : 'issue';
    add(kind, Number(match[1]), `${kind === 'pull' ? '!' : '#'}${match[1]}`);
  }

  for (const match of message.matchAll(/(?<!\w)!(\d+)/g)) {
    add('pull', Number(match[1]), `!${match[1]}`);
  }
  for (const match of message.matchAll(/(?:[\w.-]+\/[\w.-]+)?#(\d+)/g)) {
    if (!links.some((link) => link.number === Number(match[1]))) {
      add('issue', Number(match[1]), `#${match[1]}`);
    }
  }

  return links;
}

function renderHashes(text: string, keyPrefix: string, onOpenCommit: (hash: string) => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\b[0-9a-f]{7,40}\b/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    const token = match[0];
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <button
        key={`${keyPrefix}-hash-${index++}`}
        type="button"
        className="btn btn--link mono hash-link"
        title={`Go to ${token}`}
        onClick={() => onOpenCommit(token)}
      >
        {token}
      </button>
    );
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
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
  const links = messageLinks(detail.message, props.items);

  return (
    <div className="detail">
      <div className="detail__header">
        <span className="mono detail__hash">{detail.hash.slice(0, 10)}</span>
        <button className="btn btn--small" onClick={() => props.onCopy(detail.hash)}>
          Copy
        </button>
      </div>

      <div className="detail__subject">{renderHashes(subject, 'subject', props.onOpenCommit)}</div>
      {body && (
        <div className={`detail__body ${expanded ? 'detail__body--expanded' : ''}`}>
          <div className="detail__body-text">{renderHashes(body, 'body', props.onOpenCommit)}</div>
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
        <dd>
          {formatDateTime(detail.authorDate)}
          <span className="muted"> authored</span>
        </dd>
        <dt>Committer</dt>
        <dd>
          {detail.committerName} <span className="muted">&lt;{detail.committerEmail}&gt;</span>
        </dd>
        <dt>Commit date</dt>
        <dd>{formatDateTime(detail.commitDate)}</dd>
        {detail.signature && (
          <>
            <dt>Signature</dt>
            <dd>
              <span className="mono">{detail.signature}</span>
              {detail.signer ? <span className="muted"> {detail.signer}</span> : null}
            </dd>
          </>
        )}
        {detail.contains.length > 0 && (
          <>
            <dt>Refs here</dt>
            <dd className="meta__refs">
              {detail.contains.map((ref) => (
                <span key={ref} className="meta__ref">{ref}</span>
              ))}
            </dd>
          </>
        )}
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

      {links.length > 0 && (
        <div className="detail__links">
          <span className="detail__links-label">Linked</span>
          {links.map((link) => (
            <button
              key={link.key}
              className="btn btn--small detail__link"
              title={link.label}
              onClick={() => props.onOpenBoardItem({ providerId: link.providerId, kind: link.kind, number: link.number })}
            >
              {link.label}
            </button>
          ))}
        </div>
      )}

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
                  title="Copy path"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCopy(file.path);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="btn btn--icon btn--tiny"
                  title="Compare with Working Tree"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenFileWithLocal(file, false);
                  }}
                >
                  ⇄
                </button>
                <button
                  className="btn btn--icon btn--tiny"
                  title="Compare before with Working Tree"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenFileWithLocal(file, true);
                  }}
                >
                  ⇆
                </button>
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
