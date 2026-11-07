import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BoardAuthor,
  BoardComment,
  BoardItemDetail,
  BoardItemSummary,
  BoardKind,
  BoardLabel,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardStateFilter
} from '../shared/board';
import { onMessage, post } from './bridge';

const KIND_LABEL: Record<BoardKind, string> = {
  issue: 'Issues',
  pull: 'Pull requests',
  discussion: 'Discussions'
};

type IconName =
  | 'issue'
  | 'issue-closed'
  | 'pull'
  | 'pull-closed'
  | 'merge'
  | 'discussion'
  | 'record'
  | 'search'
  | 'plus'
  | 'chevron'
  | 'refresh'
  | 'comment'
  | 'copy'
  | 'external'
  | 'close'
  | 'repo';

const ICONS: Record<IconName, ReactNode> = {
  issue: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  'issue-closed': (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <path d="m5.4 8.1 1.7 1.7 3.6-3.7" />
    </>
  ),
  pull: (
    <>
      <circle cx="4.6" cy="3.6" r="1.7" />
      <circle cx="4.6" cy="12.4" r="1.7" />
      <circle cx="11.4" cy="4.4" r="1.7" />
      <path d="M4.6 5.3v5.4" />
      <path d="M11.4 6.1v1.5c0 2.1-1.5 3.6-3.4 3.9" />
    </>
  ),
  'pull-closed': (
    <>
      <circle cx="4.6" cy="3.6" r="1.7" />
      <circle cx="11.4" cy="4.4" r="1.7" />
      <path d="M4.6 5.3v5.4" />
      <path d="m5.4 11.6 4.2-4.2M9.6 11.6 5.4 7.4" />
    </>
  ),
  merge: (
    <>
      <circle cx="4.6" cy="3.6" r="1.7" />
      <circle cx="4.6" cy="12.4" r="1.7" />
      <circle cx="11.4" cy="12.4" r="1.7" />
      <path d="M4.6 5.3v5.4" />
      <path d="M11.4 10.7V6.9a3.3 3.3 0 0 0-3.3-3.3H6.3" />
    </>
  ),
  discussion: (
    <path d="M2.9 3.2h10.2c.6 0 1 .45 1 1v5.6c0 .55-.4 1-1 1H8.3l-2.7 2.1v-2.1H2.9c-.6 0-1-.45-1-1V4.2c0-.55.4-1 1-1Z" />
  ),
  record: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="7.1" cy="7.1" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" />,
  chevron: <path d="m4.5 6.2 3.5 3.6 3.5-3.6" />,
  refresh: (
    <>
      <path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9" />
      <path d="M13.6 2.7v3.2h-3.2" />
    </>
  ),
  comment: (
    <path d="M13.6 9.5c0 .9-.7 1.6-1.7 1.6H8.2l-2.7 2v-2H3.1c-.9 0-1.6-.7-1.6-1.6V4.7c0-.9.7-1.6 1.6-1.6h8.8c1 0 1.7.7 1.7 1.6Z" />
  ),
  copy: (
    <>
      <rect x="5.6" y="5.6" width="7.4" height="7.4" rx="1.6" />
      <path d="M10.9 5.6V4.1c0-.9-.7-1.6-1.6-1.6H4.1c-.9 0-1.6.7-1.6 1.6v5.2c0 .9.7 1.6 1.6 1.6h1.5" />
    </>
  ),
  external: (
    <>
      <path d="M9.4 2.9h3.7v3.7" />
      <path d="M13.1 2.9 7.9 8.1" />
      <path d="M12 9.6v2.3c0 .7-.55 1.2-1.2 1.2H3.7c-.65 0-1.2-.5-1.2-1.2V4.8c0-.65.55-1.2 1.2-1.2h2.4" />
    </>
  ),
  close: <path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6" />,
  repo: (
    <>
      <path d="M2.4 4.3c0-.9.7-1.6 1.6-1.6h2.2l1.3 1.5h4.5c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H4c-.9 0-1.6-.7-1.6-1.6Z" />
      <path d="M2.4 8h11.2" />
    </>
  )
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function kindIconName(kind: BoardKind): IconName {
  return kind === 'issue' ? 'issue' : kind === 'pull' ? 'pull' : 'discussion';
}

function itemIconName(kind: BoardKind, state: BoardItemDetail['state']): IconName {
  if (kind === 'discussion') {
    return 'discussion';
  }
  if (kind === 'issue') {
    return state === 'open' ? 'issue' : 'issue-closed';
  }
  if (state === 'merged') {
    return 'merge';
  }
  return state === 'open' ? 'pull' : 'pull-closed';
}

function iconTone(state: BoardItemDetail['state'], draft?: boolean): string {
  if (draft) {
    return 'draft';
  }
  if (state === 'merged') {
    return 'merged';
  }
  return state === 'open' ? 'open' : 'closed';
}

function ItemIcon({
  kind,
  state,
  draft,
  className
}: {
  kind: BoardKind;
  state: BoardItemDetail['state'];
  draft?: boolean;
  className?: string;
}) {
  return (
    <Icon
      name={itemIconName(kind, state)}
      className={`item-icon item-icon--${iconTone(state, draft)}${className ? ` ${className}` : ''}`}
    />
  );
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return '';
  }
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60]
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

function Avatar({ author, small }: { author: BoardItemSummary['author']; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const className = small ? 'avatar avatar--sm' : 'avatar';
  if (!author) {
    return <span className={`${className} avatar--empty`}>?</span>;
  }
  if (!author.avatarUrl || broken) {
    return <span className={className}>{author.login.slice(0, 1).toUpperCase()}</span>;
  }
  return <img className={className} src={author.avatarUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function StateBadge({ kind, state, draft }: { kind: BoardKind; state: BoardItemDetail['state']; draft?: boolean }) {
  if (draft) {
    return (
      <span className="state state--draft">
        <Icon name="pull" className="state__icon" />
        Draft
      </span>
    );
  }
  if (state === 'merged') {
    return (
      <span className="state state--merged">
        <Icon name="merge" className="state__icon" />
        Merged
      </span>
    );
  }
  if (state === 'closed') {
    return (
      <span className="state state--closed">
        <Icon name={kind === 'pull' ? 'pull-closed' : 'issue-closed'} className="state__icon" />
        Closed
      </span>
    );
  }
  return (
    <span className="state state--open">
      <Icon name={kind === 'pull' ? 'pull' : 'record'} className="state__icon" />
      Open
    </span>
  );
}

function LabelChip({ name, color, onRemove, disabled }: { name: string; color?: string | null; onRemove?: () => void; disabled?: boolean }) {
  return (
    <span className="label">
      <span className="label__dot" style={color ? { background: `#${color.replace(/^#/, '')}` } : undefined} />
      <span className="label__name">{name}</span>
      {onRemove ? (
        <button type="button" className="label__remove" aria-label={`Remove label ${name}`} title={`Remove label ${name}`} disabled={disabled} onClick={onRemove}>
          <Icon name="close" />
        </button>
      ) : null}
    </span>
  );
}

function ReviewerChip({ author, onRemove, disabled }: { author: BoardAuthor; onRemove?: () => void; disabled?: boolean }) {
  return (
    <span className="reviewer">
      <Avatar author={author} small />
      <span className="reviewer__login">{author.login}</span>
      {onRemove ? (
        <button
          type="button"
          className="reviewer__remove"
          aria-label={`Remove reviewer ${author.login}`}
          title={`Remove reviewer ${author.login}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </span>
  );
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(link
        ? <a key={key} href={link[2]} onClick={(event) => { event.preventDefault(); post({ type: 'openExternal', url: link[2] }); }}>{link[1]}</a>
        : token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

function Markdown({ body }: { body: string }) {
  const blocks = useMemo(() => {
    const lines = body.replace(/\r\n?/g, '\n').split('\n');
    const output: ReactNode[] = [];
    let index = 0;
    let key = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim().startsWith('```')) {
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        output.push(<pre key={key++}><code>{code.join('\n')}</code></pre>);
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const Tag = `h${Math.min(6, heading[1].length + 1)}` as 'h2';
        output.push(<Tag key={key++}>{inline(heading[2], `h${key}`)}</Tag>);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
          index += 1;
        }
        output.push(<ul key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `li${key}-${itemIndex}`)}</li>)}</ul>);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
          index += 1;
        }
        output.push(<ol key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, `ol${key}-${itemIndex}`)}</li>)}</ol>);
        continue;
      }
      if (line.trim().startsWith('>')) {
        const quote: string[] = [];
        while (index < lines.length && lines[index].trim().startsWith('>')) {
          quote.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        output.push(<blockquote key={key++}>{inline(quote.join('\n'), `q${key}`)}</blockquote>);
        continue;
      }
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      const paragraph: string[] = [];
      while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,6})\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+|^\s*>|^```/.test(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      if (paragraph.length === 0) {
        paragraph.push(line);
        index += 1;
      }
      output.push(<p key={key++}>{inline(paragraph.join('\n'), `p${key}`)}</p>);
    }
    return output;
  }, [body]);
  return <div className="markdown">{blocks}</div>;
}

function ListRow({ item, active, onSelect }: { item: BoardItemSummary; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`row${active ? ' row--active' : ''}`} aria-current={active || undefined} onClick={onSelect}>
      <ItemIcon kind={item.kind} state={item.state} draft={item.draft} className="row__icon" />
      <span className="row__content">
        <span className="row__title">
          {item.title}
          {item.draft ? <span className="row__tag">Draft</span> : null}
        </span>
        <span className="row__meta">
          <span className="row__number">#{item.number}</span>
          {item.author ? (
            <span className="row__person">
              <Avatar author={item.author} small />
              <span className="row__login">{item.author.login}</span>
            </span>
          ) : null}
          <span>{relativeTime(item.updatedAt)}</span>
          {item.commentCount > 0 ? (
            <span className="row__comments">
              <Icon name="comment" className="row__meta-icon" />
              {item.commentCount}
            </span>
          ) : null}
          {item.labels.slice(0, 2).map((label) => <LabelChip key={label.name} {...label} />)}
        </span>
      </span>
    </button>
  );
}

function CommentView({ comment }: { comment: BoardComment }) {
  return (
    <article className={`comment${comment.isAnswer ? ' comment--answer' : ''}`}>
      <div className="comment__head">
        <Avatar author={comment.author} />
        <span className="comment__author">{comment.author?.login ?? 'unknown'}</span>
        <span className="comment__time">{relativeTime(comment.createdAt)}</span>
        {comment.isAnswer ? <span className="state state--open comment__answer">Answer</span> : null}
      </div>
      <Markdown body={comment.body} />
    </article>
  );
}

function DetailPane({
  detail,
  loading,
  busy,
  repoLabel,
  hostLabel,
  labelOptions,
  reviewerOptions,
  onComment,
  onSetState,
  onMerge,
  onSetLabels,
  onSetReviewers,
  onReview,
  onOpen,
  onCopy
}: {
  detail: BoardItemDetail | null;
  loading: boolean;
  busy: boolean;
  repoLabel: string;
  hostLabel: string;
  labelOptions: BoardLabel[] | null;
  reviewerOptions: BoardAuthor[] | null;
  onComment: (body: string) => void;
  onSetState: (state: 'open' | 'closed') => void;
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void;
  onSetLabels: (names: string[]) => void;
  onSetReviewers: (names: string[]) => void;
  onReview: (verdict: 'approve' | 'request-changes') => void;
  onOpen: (url: string) => void;
  onCopy: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');

  if (loading && !detail) {
    return <div className="detail detail--empty">Loading…</div>;
  }
  if (!detail) {
    return <div className="detail detail--empty">Select an item to preview it.</div>;
  }

  const actions = detail.canClose || detail.canReopen || detail.canMerge;
  const showFooter = detail.canComment || actions || detail.canReview;
  const reviewers = detail.reviewers ?? [];
  const labelNames = new Set(detail.labels.map((label) => label.name));
  const addableLabels = labelOptions?.filter((label) => !labelNames.has(label.name)) ?? [];
  const reviewerLogins = new Set(reviewers.map((reviewer) => reviewer.login.toLowerCase()));
  const addableReviewers = reviewerOptions?.filter((reviewer) => !reviewerLogins.has(reviewer.login.toLowerCase())) ?? [];

  return (
    <div className="detail">
      <header className="detail__header">
        <div className="detail__kicker">
          <StateBadge kind={detail.kind} state={detail.state} draft={detail.draft} />
          <span className="detail__ref">
            {repoLabel ? `${repoLabel} ` : ''}
            <span className="detail__number">#{detail.number}</span>
          </span>
          <div className="detail__actions">
            <button
              type="button"
              className="icon-btn"
              title="Copy link"
              aria-label="Copy link"
              onClick={() => onCopy(detail.url)}
            >
              <Icon name="copy" />
            </button>
            <button
              type="button"
              className="ghost-link"
              title={`Open on ${hostLabel}`}
              aria-label={`Open on ${hostLabel}`}
              onClick={() => onOpen(detail.url)}
            >
              {hostLabel}
              <Icon name="external" />
            </button>
          </div>
        </div>
        <h1 className="detail__title">{detail.title}</h1>
      </header>

      <div className="detail__body">
        <dl className="meta">
          <dt>Author</dt>
          <dd>
            {detail.author ? (
              <>
                <Avatar author={detail.author} small />
                <span>{detail.author.login}</span>
              </>
            ) : (
              <span className="meta__none">Unknown</span>
            )}
          </dd>
          <dt>Updated</dt>
          <dd>{relativeTime(detail.updatedAt)}</dd>
          {detail.base && detail.head ? (
            <>
              <dt>Branch</dt>
              <dd className="meta__mono">
                <span>{detail.head}</span>
                <span className="meta__arrow">→</span>
                <span>{detail.base}</span>
              </dd>
            </>
          ) : null}
          {detail.additions != null ? (
            <>
              <dt>Changes</dt>
              <dd className="meta__changes">
                <span className="add">+{detail.additions}</span>
                <span className="del">−{detail.deletions ?? 0}</span>
              </dd>
            </>
          ) : null}
          {detail.category ? (
            <>
              <dt>Category</dt>
              <dd>{detail.category}</dd>
            </>
          ) : null}
          <dt>Labels</dt>
          <dd>
            {detail.labels.length > 0
              ? detail.labels.map((label) => (
                  <LabelChip
                    key={label.name}
                    {...label}
                    disabled={busy}
                    onRemove={
                      detail.canEditLabels
                        ? () => onSetLabels(detail.labels.filter((entry) => entry.name !== label.name).map((entry) => entry.name))
                        : undefined
                    }
                  />
                ))
              : <span className="meta__none">None</span>}
            {detail.canEditLabels ? (
              labelOptions === null ? (
                <span className="meta__note">Loading labels…</span>
              ) : labelOptions.length === 0 ? (
                <span className="meta__note">No labels available</span>
              ) : addableLabels.length > 0 ? (
                <label className="chip-add">
                  <Icon name="plus" className="chip-add__icon" />
                  <select
                    value=""
                    aria-label="Add label"
                    disabled={busy}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      onSetLabels([...detail.labels.map((entry) => entry.name), event.target.value]);
                    }}
                  >
                    <option value="" disabled>Add label</option>
                    {addableLabels.map((label) => <option key={label.name} value={label.name}>{label.name}</option>)}
                  </select>
                  <Icon name="chevron" className="chip-add__chevron" />
                </label>
              ) : null
            ) : null}
          </dd>
          {detail.reviewers || detail.canEditReviewers ? (
            <>
              <dt>Reviewers</dt>
              <dd>
                {reviewers.length > 0
                  ? reviewers.map((reviewer) => (
                      <ReviewerChip
                        key={reviewer.login}
                        author={reviewer}
                        disabled={busy}
                        onRemove={
                          detail.canEditReviewers
                            ? () => onSetReviewers(reviewers.filter((entry) => entry.login !== reviewer.login).map((entry) => entry.login))
                            : undefined
                        }
                      />
                    ))
                  : <span className="meta__none">None</span>}
                {detail.canEditReviewers ? (
                  reviewerOptions === null ? (
                    <span className="meta__note">Loading reviewers…</span>
                  ) : reviewerOptions.length === 0 ? (
                    <span className="meta__note">No reviewer candidates</span>
                  ) : addableReviewers.length > 0 ? (
                    <label className="chip-add">
                      <Icon name="plus" className="chip-add__icon" />
                      <select
                        value=""
                        aria-label="Add reviewer"
                        disabled={busy}
                        onChange={(event) => {
                          if (!event.target.value) return;
                          onSetReviewers([...reviewers.map((entry) => entry.login), event.target.value]);
                        }}
                      >
                        <option value="" disabled>Add reviewer</option>
                        {addableReviewers.map((reviewer) => <option key={reviewer.login} value={reviewer.login}>{reviewer.login}</option>)}
                      </select>
                      <Icon name="chevron" className="chip-add__chevron" />
                    </label>
                  ) : null
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>

        <Markdown body={detail.body || '_No description._'} />

        <section className="comments">
          <h2>{detail.comments.length} comment{detail.comments.length === 1 ? '' : 's'}</h2>
          {detail.comments.map((comment) => <CommentView key={comment.id} comment={comment} />)}
        </section>
      </div>

      {showFooter ? (
        <footer className="detail__footer">
          {detail.canComment ? (
            <div className="composer">
              <textarea
                value={draft}
                aria-label="Leave a comment"
                placeholder="Leave a comment…"
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
          ) : (
            <p className="detail__closed">Comments are not available for this item.</p>
          )}
          <div className="detail__footerbar">
            {actions || detail.canReview ? (
              <div className="detail__itemactions">
                {detail.canClose ? (
                  <button className="btn" disabled={busy} onClick={() => onSetState('closed')}>Close</button>
                ) : null}
                {detail.canReopen ? (
                  <button className="btn" disabled={busy} onClick={() => onSetState('open')}>Reopen</button>
                ) : null}
                {detail.canMerge ? (
                  <>
                    {(detail.mergeMethods ?? ['merge', 'squash'])
                      .filter((method): method is 'merge' | 'squash' | 'rebase' => method === 'merge' || method === 'squash' || method === 'rebase')
                      .map((method) => (
                        <button
                          key={method}
                          className={`btn${method === 'merge' ? '' : ' btn--accent'}`}
                          disabled={busy}
                          onClick={() => onMerge(method)}
                        >
                          {method === 'merge' ? 'Merge' : method === 'squash' ? 'Squash & merge' : 'Rebase & merge'}
                        </button>
                      ))}
                  </>
                ) : null}
                {detail.canReview ? (
                  detail.reviewModel === 'votes' ? (
                    <span className="detail__note">Votes are not supported yet.</span>
                  ) : (
                    <>
                      <button className="btn btn--approve" disabled={busy} onClick={() => onReview('approve')}>Approve</button>
                      <button className="btn" disabled={busy} onClick={() => onReview('request-changes')}>Request changes</button>
                    </>
                  )
                ) : null}
              </div>
            ) : null}
            {detail.canComment ? (
              <button
                className="btn btn--primary"
                disabled={busy || draft.trim().length === 0}
                onClick={() => {
                  onComment(draft.trim());
                  setDraft('');
                }}
              >
                Comment
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

export function App() {
  const [repo, setRepo] = useState<BoardRepoInfo | null>(null);
  const [providers, setProviders] = useState<BoardProviderInfo[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [stateError, setStateError] = useState<string | undefined>();
  const [kind, setKind] = useState<BoardKind>('issue');
  const [filter, setFilter] = useState<BoardStateFilter>('open');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<BoardItemSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | undefined>();
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<BoardItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | undefined>();
  const [labelOptions, setLabelOptions] = useState<BoardLabel[] | null>(null);
  const [reviewerOptions, setReviewerOptions] = useState<BoardAuthor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const requestId = useRef(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailKey = useRef<string | null>(null);
  const labelsRequest = useRef(0);
  const reviewersRequest = useRef(0);
  const activeProvider = useRef<string | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const off = onMessage((message) => {
      if (message.type === 'state') {
        if (activeProvider.current !== message.providerId) {
          activeProvider.current = message.providerId;
          setItems([]);
          setSelected(null);
          setDetail(null);
          setHasMore(false);
          if (message.repo && !message.repo.kinds.includes(kind)) {
            setKind(message.repo.kinds[0] ?? 'issue');
          }
        }
        setRepo(message.repo);
        setProviders(message.providers);
        setProviderId(message.providerId);
        setAuthenticated(message.authenticated);
        setStateError(message.error);
        return;
      }
      if (message.type === 'list') {
        if (message.requestId !== 0 && message.requestId !== listRequest.current) {
          return;
        }
        setItems((current) => {
          if (message.requestId !== 0 || message.result.page <= 1) {
            return message.result.items;
          }
          const seen = new Set(current.map((item) => `${item.kind}-${item.number}`));
          return [...current, ...message.result.items.filter((item) => !seen.has(`${item.kind}-${item.number}`))];
        });
        setHasMore(message.result.hasMore);
        setListLoading(false);
        setListError(undefined);
        return;
      }
      if (message.type === 'detail') {
        if (message.requestId !== 0 && message.requestId !== detailRequest.current) {
          return;
        }
        const next = message.detail;
        const key = next ? `${next.kind}-${next.number}` : null;
        if (key === null || key !== detailKey.current) {
          setLabelOptions(null);
          setReviewerOptions(null);
        }
        detailKey.current = key;
        setDetail(next);
        setDetailLoading(false);
        setDetailError(message.error);
        labelsRequest.current = 0;
        reviewersRequest.current = 0;
        if (next?.canEditLabels) {
          const id = ++requestId.current;
          labelsRequest.current = id;
          post({ type: 'listLabels', requestId: id });
        }
        if (next?.canEditReviewers) {
          const id = ++requestId.current;
          reviewersRequest.current = id;
          post({ type: 'listReviewers', requestId: id });
        }
        return;
      }
      if (message.type === 'labels') {
        if (message.requestId !== labelsRequest.current) {
          return;
        }
        setLabelOptions(message.labels);
        return;
      }
      if (message.type === 'reviewers') {
        if (message.requestId !== reviewersRequest.current) {
          return;
        }
        setReviewerOptions(message.reviewers);
        return;
      }
      if (message.type === 'busy') {
        setBusy(message.busy);
        setBusyLabel(message.operation);
        return;
      }
      if (message.type === 'error') {
        setListLoading(false);
        setDetailLoading(false);
        setListError(message.message);
        setDetailError(message.message);
      }
    });
    post({ type: 'ready' });
    return off;
  }, []);

  const loadList = (nextPage: number, append: boolean, overrides?: { search?: string }) => {
    if (!authenticated) {
      return;
    }
    const id = ++requestId.current;
    listRequest.current = id;
    setListLoading(true);
    if (!append) {
      setListError(undefined);
    }
    post({
      type: 'list',
      requestId: id,
      query: { kind, state: filter, search: overrides?.search ?? search, page: nextPage, perPage: 50 }
    });
  };

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    setSelected(null);
    setDetail(null);
    setPage(1);
    loadList(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, filter, authenticated, repo?.owner, repo?.name]);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
    }
    searchTimer.current = window.setTimeout(() => {
      setPage(1);
      loadList(1, false, { search: value });
    }, 300);
  };

  const selectItem = (item: BoardItemSummary) => {
    setSelected(item.number);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(undefined);
    const id = ++requestId.current;
    detailRequest.current = id;
    post({ type: 'detail', requestId: id, kind: item.kind, number: item.number });
  };

  const kinds = repo?.kinds ?? (['issue', 'pull', 'discussion'] as BoardKind[]);

  useEffect(() => {
    if (!kinds.includes(kind)) {
      setKind(kinds[0] ?? 'issue');
    }
  }, [kinds, kind]);

  const repoLabel = repo ? `${repo.owner}/${repo.name}` : '';

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead__title">Issues and PRs</span>
        <div className="masthead__actions">
          {providers.length > 1 ? (
            <select
              className="select select--sm"
              value={providerId ?? ''}
              onChange={(event) => post({ type: 'selectProvider', providerId: event.target.value })}
            >
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
          ) : (
            <span className="masthead__provider">{repo?.providerLabel ?? providerId ?? 'No provider'}</span>
          )}
        </div>
      </header>

      {!repo ? (
        <div className="empty">
          <h2>No supported remote</h2>
          <p>This repository has no supported Git host remote. Add one, or install an OpenChamber integration provider.</p>
        </div>
      ) : !authenticated ? (
        <div className="empty">
          <h2>Connect {repo.providerLabel}</h2>
          <p>Git Studio needs a token with repository read access to list issues, pull requests and discussions.</p>
          {stateError ? <p className="error">{stateError}</p> : null}
          <button className="btn btn--primary" onClick={() => post({ type: 'connectProvider', providerId: providerId ?? 'github' })}>
            Connect {repo.providerLabel}
          </button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Item kind">
              {kinds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={kind === entry}
                  className={`tab${kind === entry ? ' tab--active' : ''}`}
                  onClick={() => setKind(entry)}
                >
                  <Icon name={kindIconName(entry)} className="tab__icon" />
                  {KIND_LABEL[entry]}
                </button>
              ))}
            </div>
            {repo ? (
              <span className="scope" title={repoLabel}>
                <Icon name="repo" className="scope__icon" />
                <span className="scope__label">{repoLabel}</span>
              </span>
            ) : null}
            <div className="toolbar__right">
              <label className="search">
                <Icon name="search" className="search__icon" />
                <input
                  value={search}
                  placeholder={`Search ${KIND_LABEL[kind].toLowerCase()}…`}
                  aria-label={`Search ${KIND_LABEL[kind].toLowerCase()}`}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    className="search__clear"
                    aria-label="Clear search"
                    title="Clear search"
                    onClick={() => onSearchChange('')}
                  >
                    <Icon name="close" />
                  </button>
                ) : null}
              </label>
              <div className="filter">
                <select
                  value={filter}
                  aria-label="Filter by state"
                  onChange={(event) => setFilter(event.target.value as BoardStateFilter)}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="all">All</option>
                </select>
                <Icon name="chevron" className="filter__chevron" />
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--outlined"
                title="Refresh"
                aria-label="Refresh"
                onClick={() => post({ type: 'refresh' })}
              >
                <Icon name="refresh" />
              </button>
            </div>
          </div>

          <div className="workspace">
            <aside className="listpane">
              <div className="list">
                {listLoading && items.length === 0 ? <div className="list__status">Loading…</div> : null}
                {listError ? <div className="list__status error">{listError}</div> : null}
                {!listLoading && !listError && items.length === 0 ? (
                  <div className="list__status">No {KIND_LABEL[kind].toLowerCase()} found.</div>
                ) : null}
                {items.map((item) => (
                  <ListRow
                    key={`${item.kind}-${item.number}`}
                    item={item}
                    active={selected === item.number}
                    onSelect={() => selectItem(item)}
                  />
                ))}
                {hasMore ? (
                  <button
                    className="btn list__more"
                    disabled={listLoading}
                    onClick={() => {
                      const next = page + 1;
                      setPage(next);
                      loadList(next, true);
                    }}
                  >
                    {listLoading ? 'Loading…' : 'Load more'}
                  </button>
                ) : null}
              </div>
            </aside>
            <main className="detailpane">
              {detailError ? <div className="detail__error">{detailError}</div> : null}
              {busy ? <div className="busybar">{busyLabel ?? 'Working'}…</div> : null}
              <DetailPane
                key={detail ? `${detail.kind}-${detail.number}` : 'empty'}
                detail={detail}
                loading={detailLoading}
                busy={busy}
                repoLabel={repoLabel}
                hostLabel={repo?.providerLabel ?? 'GitHub'}
                labelOptions={labelOptions}
                reviewerOptions={reviewerOptions}
                onComment={(body) => {
                  if (selected == null) return;
                  post({ type: 'comment', kind, number: selected, body });
                }}
                onSetState={(state) => {
                  if (selected == null) return;
                  post({ type: 'setState', kind, number: selected, state });
                }}
                onMerge={(method) => {
                  if (selected == null) return;
                  post({ type: 'merge', number: selected, method });
                }}
                onSetLabels={(names) => {
                  if (selected == null) return;
                  post({ type: 'setLabels', number: selected, names });
                }}
                onSetReviewers={(names) => {
                  if (selected == null) return;
                  post({ type: 'setReviewers', number: selected, names });
                }}
                onReview={(verdict) => {
                  if (selected == null) return;
                  post({ type: 'review', number: selected, verdict });
                }}
                onOpen={(url) => post({ type: 'openExternal', url })}
                onCopy={(text) => post({ type: 'copy', text })}
              />
            </main>
          </div>
        </>
      )}
    </div>
  );
}
