import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject
} from 'react';
import type {
  BoardAuthor,
  BoardCheck,
  BoardComment,
  BoardItemDetail,
  BoardItemSummary,
  BoardKind,
  BoardLabel,
  BoardProviderInfo,
  BoardRepoInfo,
  BoardStateFilter,
  BoardTrackerDetail,
  BoardTrackerItem,
  BoardTrackerState
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
  | 'check'
  | 'list'
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
  check: <path d="m3.4 8.3 3.1 3.1 6.1-6.9" />,
  list: <path d="M3 4.4h10M3 8h10M3 11.6h10" />,
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

function ListRow({
  item,
  active,
  keyboardActive,
  id,
  onSelect
}: {
  item: BoardItemSummary;
  active: boolean;
  keyboardActive: boolean;
  id: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      tabIndex={-1}
      role="option"
      className={`row${active ? ' row--active' : ''}${keyboardActive ? ' row--kbd' : ''}`}
      aria-selected={active}
      aria-current={active || undefined}
      data-list-active={keyboardActive || undefined}
      onClick={onSelect}
    >
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

const LIST_WIDTH_KEY = 'gitstudio.board.listWidth';
const MIN_LIST_WIDTH = 260;
const NARROW_BREAKPOINT = 760;

function readStoredListWidth(): number | null {
  try {
    const value = Number.parseInt(window.localStorage.getItem(LIST_WIDTH_KEY) ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

type MergeMethod = 'merge' | 'squash' | 'rebase';

const MERGE_METHOD_KEY = 'gitstudio.board.mergeMethod';
const MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
  merge: 'Merge',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge'
};

function isMergeMethod(value: string): value is MergeMethod {
  return value === 'merge' || value === 'squash' || value === 'rebase';
}

function readStoredMergeMethod(): MergeMethod {
  try {
    const value = window.localStorage.getItem(MERGE_METHOD_KEY);
    return value && isMergeMethod(value) ? value : 'merge';
  } catch {
    return 'merge';
  }
}

const CLOSE_REASON_LABEL: Record<BoardKind, Record<string, string>> = {
  issue: { completed: 'Close as completed', not_planned: 'Close as not planned', duplicate: 'Close as duplicate' },
  discussion: { resolved: 'Close as resolved', outdated: 'Close as outdated', duplicate: 'Close as duplicate' },
  pull: { completed: 'Close as completed', not_planned: 'Close as not planned' }
};

function closeReasonLabel(kind: BoardKind, reason: string): string {
  return CLOSE_REASON_LABEL[kind][reason] ?? `Close as ${reason.replace(/[_-]+/g, ' ')}`;
}

function checksTone(checks: NonNullable<BoardItemDetail['checks']>): 'pass' | 'fail' | 'pending' {
  if (checks.failed > 0) {
    return 'fail';
  }
  return checks.pending > 0 ? 'pending' : 'pass';
}

function checkTone(check: BoardCheck): 'pass' | 'fail' | 'pending' {
  if (check.status !== 'completed') {
    return 'pending';
  }
  if (!check.conclusion || check.conclusion === 'success' || check.conclusion === 'neutral' || check.conclusion === 'skipped') {
    return 'pass';
  }
  return 'fail';
}

function checkLabel(check: BoardCheck): string {
  return (check.conclusion ?? check.status).replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());
}

/** Close a popover on Escape or on a pointer press outside of its container. */
function useDismissable(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        closeRef.current();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRef.current();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return ref;
}

function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="loading" role="status">
      <span className="loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function ErrorState({ message, variant }: { message: string; variant: 'list' | 'detail' }) {
  return (
    <div className={variant === 'list' ? 'list__status error' : 'detail__error'}>
      <span>{message}</span>
      <button type="button" className="btn error__retry" onClick={() => post({ type: 'refresh' })}>
        Retry
      </button>
    </div>
  );
}

function useListKeyboard<T>({
  items,
  selectedIndex,
  listRef,
  onPick
}: {
  items: T[];
  selectedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onPick: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setActiveIndex((current) => {
      if (selectedIndex >= 0) {
        return selectedIndex;
      }
      if (items.length === 0) {
        return -1;
      }
      return current < 0 ? 0 : Math.min(current, items.length - 1);
    });
  }, [selectedIndex, items.length]);

  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    listRef.current?.querySelector<HTMLElement>('[data-list-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listRef]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) {
      return;
    }
    const anchor = activeIndex >= 0 ? activeIndex : selectedIndex;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(Math.min(anchor + 1, items.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(Math.max(anchor - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(items.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (activeIndex >= 0) {
          onPick(activeIndex);
        }
        break;
    }
  };

  const onFocus = () => {
    setActiveIndex((current) => (current >= 0 ? current : selectedIndex >= 0 ? selectedIndex : items.length > 0 ? 0 : -1));
  };

  return { activeIndex, onKeyDown, onFocus };
}

function SourceList({
  kind,
  items,
  selected,
  loading,
  error,
  hasMore,
  listRef,
  onSelect,
  onLoadMore
}: {
  kind: BoardKind;
  items: BoardItemSummary[];
  selected: number | null;
  loading: boolean;
  error?: string;
  hasMore: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (item: BoardItemSummary) => void;
  onLoadMore: () => void;
}) {
  const listId = useId();
  const selectedIndex = selected === null ? -1 : items.findIndex((item) => item.number === selected);
  const keyboard = useListKeyboard({ items, selectedIndex, listRef, onPick: (index) => onSelect(items[index]) });
  const activeItem = keyboard.activeIndex >= 0 ? items[keyboard.activeIndex] : undefined;

  return (
    <div
      className="list"
      ref={listRef}
      role="listbox"
      aria-label={KIND_LABEL[kind]}
      aria-activedescendant={activeItem ? `${listId}-${activeItem.number}` : undefined}
      tabIndex={0}
      onKeyDown={keyboard.onKeyDown}
      onFocus={keyboard.onFocus}
    >
      {loading && items.length === 0 ? <div className="list__status"><Loading /></div> : null}
      {error ? <ErrorState message={error} variant="list" /> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="list__status">No {KIND_LABEL[kind].toLowerCase()} found.</div>
      ) : null}
      {items.map((item, index) => (
        <ListRow
          key={`${item.kind}-${item.number}`}
          id={`${listId}-${item.number}`}
          item={item}
          active={selected === item.number}
          keyboardActive={keyboard.activeIndex === index}
          onSelect={() => {
            listRef.current?.focus();
            onSelect(item);
          }}
        />
      ))}
      {hasMore ? (
        <button className="btn list__more" disabled={loading} onClick={onLoadMore}>
          {loading ? <Loading /> : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

function TrackerList({
  items,
  selected,
  loading,
  error,
  hasMore,
  onSelect,
  onLoadMore
}: {
  items: BoardTrackerItem[];
  selected: string | null;
  loading: boolean;
  error?: string;
  hasMore: boolean;
  onSelect: (item: BoardTrackerItem) => void;
  onLoadMore: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = selected === null ? -1 : items.findIndex((item) => item.id === selected);
  const keyboard = useListKeyboard({ items, selectedIndex, listRef, onPick: (index) => onSelect(items[index]) });
  const activeItem = keyboard.activeIndex >= 0 ? items[keyboard.activeIndex] : undefined;

  return (
    <div
      className="list"
      ref={listRef}
      role="listbox"
      aria-label="Work items"
      aria-activedescendant={activeItem ? `${listId}-${activeItem.id}` : undefined}
      tabIndex={0}
      onKeyDown={keyboard.onKeyDown}
      onFocus={keyboard.onFocus}
    >
      {loading && items.length === 0 ? <div className="list__status"><Loading /></div> : null}
      {error ? <ErrorState message={error} variant="list" /> : null}
      {!loading && !error && items.length === 0 ? <div className="list__status">No work items found.</div> : null}
      {items.map((item, index) => (
        <button
          key={item.id}
          id={`${listId}-${item.id}`}
          type="button"
          tabIndex={-1}
          role="option"
          className={`row${selected === item.id ? ' row--active' : ''}${keyboard.activeIndex === index ? ' row--kbd' : ''}`}
          aria-selected={selected === item.id}
          aria-current={selected === item.id || undefined}
          data-list-active={keyboard.activeIndex === index || undefined}
          onClick={() => {
            listRef.current?.focus();
            onSelect(item);
          }}
        >
          <span className="row__content">
            <span className="row__title">{item.title}</span>
            <span className="row__meta">
              <span className="row__number">{item.identifier}</span>
              {item.state ? <span className="row__meta-item">{item.state.name}</span> : null}
              {item.assignee ? <span className="row__meta-item">{item.assignee.login}</span> : null}
              {item.labels.slice(0, 2).map((label) => <LabelChip key={label.name} {...label} />)}
            </span>
          </span>
        </button>
      ))}
      {hasMore ? (
        <button className="btn list__more" disabled={loading} onClick={onLoadMore}>
          {loading ? <Loading /> : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

function Workspace({
  narrow,
  listOpen,
  listWidth,
  onListWidthChange,
  onCloseList,
  list,
  detail
}: {
  narrow: boolean;
  listOpen: boolean;
  listWidth: number | null;
  onListWidthChange: (width: number) => void;
  onCloseList: () => void;
  list: ReactNode;
  detail: ReactNode;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!narrow || !listOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      workspaceRef.current?.querySelector<HTMLElement>('.list-overlay .list')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [narrow, listOpen]);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => setContainerWidth(node.getBoundingClientRect().width));
    observer.observe(node);
    setContainerWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const maxWidth = Math.max(MIN_LIST_WIDTH, Math.round(containerWidth * 0.6));
  const preferredWidth = listWidth ?? (Math.round(containerWidth * 0.4) || 320);
  const effectiveWidth = Math.min(Math.max(preferredWidth, MIN_LIST_WIDTH), maxWidth);
  const width = dragWidth ?? effectiveWidth;

  const clampWidth = (next: number) => Math.min(Math.max(Math.round(next), MIN_LIST_WIDTH), maxWidth);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (rect) {
      setDragWidth(clampWidth(event.clientX - rect.left));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    setDragging(false);
    if (dragWidth !== null) {
      onListWidthChange(dragWidth);
      setDragWidth(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onSeparatorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    onListWidthChange(clampWidth(effectiveWidth + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)));
  };

  return (
    <div className={`workspace${narrow ? ' workspace--narrow' : ''}`} ref={workspaceRef}>
      {narrow ? null : (
        <>
          <aside className="listpane" style={{ width: `${width}px` }}>
            {list}
          </aside>
          <div
            className={`splitter${dragging ? ' splitter--dragging' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize item list"
            aria-valuenow={width}
            aria-valuemin={MIN_LIST_WIDTH}
            aria-valuemax={maxWidth}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onSeparatorKeyDown}
          />
        </>
      )}
      <main className="detailpane">{detail}</main>
      {narrow && listOpen ? (
        <>
          <div className="list-overlay__backdrop" onClick={onCloseList} />
          <div className="list-overlay" id="board-list-overlay">
            {list}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface MultiSelectOption {
  key: string;
  label: string;
  node: ReactNode;
}

function MultiSelect({
  ariaLabel,
  disabled,
  options,
  selected,
  searchPlaceholder,
  emptyMatchText,
  renderChip,
  onApply
}: {
  ariaLabel: string;
  disabled: boolean;
  options: MultiSelectOption[];
  selected: string[];
  searchPlaceholder: string;
  emptyMatchText: string;
  renderChip: (key: string, remove: () => void) => ReactNode;
  onApply: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const ref = useDismissable(open, () => setOpen(false));

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const apply = () => {
    const known = new Set(options.map((option) => option.key));
    onApply([
      ...options.filter((option) => draft.includes(option.key)).map((option) => option.key),
      ...draft.filter((key) => !known.has(key))
    ]);
    close();
  };

  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className={`picker${open ? ' picker--open' : ''}`} ref={ref}>
      <button
        type="button"
        className="chip-add"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setQuery('');
          setDraft(selected);
          setOpen(true);
        }}
      >
        <Icon name="plus" className="chip-add__icon" />
        <span>Edit</span>
        <Icon name="chevron" className="chip-add__chevron" />
      </button>
      {open ? (
        <div
          className="picker__panel"
          role="dialog"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === searchRef.current) {
              event.preventDefault();
              apply();
            }
          }}
        >
          <input
            ref={searchRef}
            className="picker__search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          {draft.length > 0 ? (
            <div className="picker__chips">
              {options
                .filter((option) => draft.includes(option.key))
                .map((option) => (
                  <span key={option.key} className="picker__chip">
                    {renderChip(option.key, () => setDraft((current) => current.filter((key) => key !== option.key)))}
                  </span>
                ))}
              {draft
                .filter((key) => !options.some((option) => option.key === key))
                .map((key) => (
                  <span key={key} className="picker__chip">
                    {renderChip(key, () => setDraft((current) => current.filter((entry) => entry !== key)))}
                  </span>
                ))}
            </div>
          ) : null}
          <div className="picker__list">
            {filtered.length === 0 ? (
              <span className="picker__empty">{emptyMatchText}</span>
            ) : (
              filtered.map((option) => {
                const checked = draft.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`picker__row${checked ? ' picker__row--on' : ''}`}
                    aria-pressed={checked}
                    disabled={disabled}
                    onClick={() =>
                      setDraft((current) =>
                        checked ? current.filter((key) => key !== option.key) : [...current, option.key]
                      )
                    }
                  >
                    <span className="picker__check">{checked ? <Icon name="check" /> : null}</span>
                    <span className="picker__option">{option.node}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="picker__footer">
            <button
              type="button"
              className="btn picker__clear"
              disabled={disabled || draft.length === 0}
              onClick={() => setDraft([])}
            >
              Clear
            </button>
            <button type="button" className="btn btn--primary picker__apply" disabled={disabled} onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MergeButton({
  methods,
  method,
  disabled,
  onSelectMethod,
  onMerge
}: {
  methods: MergeMethod[];
  method: MergeMethod;
  disabled: boolean;
  onSelectMethod: (method: MergeMethod) => void;
  onMerge: (method: MergeMethod) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));
  const available = methods.length > 0 ? methods : (['merge'] as MergeMethod[]);
  const active = available.includes(method) ? method : available[0];
  const split = available.length > 1;

  return (
    <div className={`split-btn${split ? ' split-btn--split' : ''}`} ref={ref}>
      <button
        type="button"
        className="btn btn--accent split-btn__main"
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          onMerge(active);
        }}
      >
        <Icon name="merge" />
        {MERGE_METHOD_LABEL[active]}
      </button>
      {split ? (
        <button
          type="button"
          className="btn btn--accent split-btn__toggle"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Choose merge method"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron" />
        </button>
      ) : null}
      {open && split ? (
        <div className="menu menu--up" role="menu" aria-label="Merge method">
          {available.map((entry) => (
            <button
              key={entry}
              type="button"
              role="menuitemradio"
              aria-checked={entry === active}
              className={`menu__item${entry === active ? ' menu__item--on' : ''}`}
              onClick={() => {
                onSelectMethod(entry);
                setOpen(false);
              }}
            >
              <span className="menu__check">{entry === active ? <Icon name="check" /> : null}</span>
              {MERGE_METHOD_LABEL[entry]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CloseMenu({
  kind,
  reasons,
  disabled,
  onCloseState
}: {
  kind: BoardKind;
  reasons: string[];
  disabled: boolean;
  onCloseState: (reason?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  if (reasons.length === 0) {
    return (
      <button type="button" className="btn" disabled={disabled} onClick={() => onCloseState()}>
        Close
      </button>
    );
  }

  return (
    <div className="split-btn" ref={ref}>
      <button
        type="button"
        className="btn split-btn__main"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Close
        <Icon name="chevron" className="split-btn__caret" />
      </button>
      {open ? (
        <div className="menu menu--up" role="menu" aria-label="Close reason">
          {reasons.map((reason) => (
            <button
              key={reason}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false);
                onCloseState(reason);
              }}
            >
              {closeReasonLabel(kind, reason)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChecksDialog({
  title,
  checks,
  loading,
  error,
  onClose,
  onRefresh,
  onOpen
}: {
  title: string;
  checks: BoardCheck[] | null;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (url: string) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="checks-title" onClick={(event) => event.stopPropagation()}>
        <header className="modal__head">
          <div className="modal__titles">
            <h2 id="checks-title">Checks</h2>
            <p className="modal__subtitle" title={title}>{title}</p>
          </div>
          <div className="modal__actions">
            <button type="button" className="icon-btn" title="Refresh checks" aria-label="Refresh checks" disabled={loading} onClick={onRefresh}>
              <Icon name="refresh" />
            </button>
            <button type="button" className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="modal__body">
          {loading && checks === null ? <div className="modal__status"><Loading label="Loading checks…" /></div> : null}
          {error ? <p className="checks-error">{error}</p> : null}
          {checks && checks.length === 0 && !loading ? <p className="modal__status">No checks reported for this item.</p> : null}
          {checks && checks.length > 0 ? (
            <ul className="checks">
              {checks.map((check, index) => {
                const tone = checkTone(check);
                const url = check.url;
                return (
                  <li key={`${check.name}-${index}`} className={`check check--${tone}`}>
                    <span className="check__dot" />
                    <div className="check__main">
                      <span className="check__name">{check.name}</span>
                      {check.description ? <span className="check__desc">{check.description}</span> : null}
                    </div>
                    <span className={`check__state check__state--${tone}`}>{checkLabel(check)}</span>
                    {url ? (
                      <a
                        className="check__link"
                        href={url}
                        onClick={(event) => {
                          event.preventDefault();
                          onOpen(url);
                        }}
                      >
                        Open
                        <Icon name="external" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {loading && checks !== null ? <div className="modal__note"><Loading label="Refreshing…" /></div> : null}
        </div>
      </div>
    </div>
  );
}

function ThreadReply({ threadId, busy, onReply }: { threadId: string; busy: boolean; onReply: (threadId: string, body: string) => void }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn btn--tiny thread__reply" type="button" disabled={busy} onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  }
  return (
    <div className="thread__replybox">
      <textarea
        value={draft}
        aria-label="Reply to this review thread"
        placeholder="Reply…"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="thread__replyactions">
        <button className="btn btn--tiny" type="button" onClick={() => { setOpen(false); setDraft(''); }}>
          Cancel
        </button>
        <button
          className="btn btn--tiny btn--primary"
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => {
            const body = draft.trim();
            if (!body) {
              return;
            }
            onReply(threadId, body);
            setDraft('');
            setOpen(false);
          }}
        >
          Reply
        </button>
      </div>
    </div>
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
  mergeMethod,
  onMergeMethodChange,
  onComment,
  onSetState,
  onMerge,
  onMarkReady,
  onOpenChecks,
  onSetLabels,
  onSetReviewers,
  onReview,
  onVote,
  onReply,
  onOpen,
  onCopy,
  onRefresh
}: {
  detail: BoardItemDetail | null;
  loading: boolean;
  busy: boolean;
  repoLabel: string;
  hostLabel: string;
  labelOptions: BoardLabel[] | null;
  reviewerOptions: BoardAuthor[] | null;
  mergeMethod: MergeMethod;
  onMergeMethodChange: (method: MergeMethod) => void;
  onComment: (body: string) => void;
  onSetState: (state: 'open' | 'closed', reason?: string) => void;
  onMerge: (method: MergeMethod) => void;
  onMarkReady: () => void;
  onOpenChecks: () => void;
  onSetLabels: (names: string[]) => void;
  onSetReviewers: (names: string[]) => void;
  onReview: (verdict: 'approve' | 'request-changes') => void;
  onVote: (votes: Record<string, number>) => void;
  onReply: (threadId: string, body: string) => void;
  onOpen: (url: string) => void;
  onCopy: (text: string) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [votes, setVotes] = useState<Record<string, number>>({});

  if (loading && !detail) {
    return (
      <div className="detail detail--empty">
        <Loading />
      </div>
    );
  }
  if (!detail) {
    return <div className="detail detail--empty">Select an item to preview it.</div>;
  }

  const actions = detail.canClose || detail.canReopen || detail.canMerge || detail.canMarkReady;
  const showFooter = detail.canComment || actions || detail.canReview;
  const reviewers = detail.reviewers ?? [];
  const reviewThreads = detail.reviewThreads ?? [];
  const voteLabels = (detail.voteLabels ?? []).filter((label) => label.permitted.length > 0);
  const mergeMethods = (detail.mergeMethods ?? ['merge', 'squash']).filter(isMergeMethod);
  const closeReasons = detail.canClose ? detail.closeReasons ?? [] : [];

  const labelChoices: BoardLabel[] = [];
  const seenLabels = new Set<string>();
  for (const label of [...detail.labels, ...(labelOptions ?? [])]) {
    if (!seenLabels.has(label.name)) {
      seenLabels.add(label.name);
      labelChoices.push(label);
    }
  }
  const labelByKey = new Map(labelChoices.map((label) => [label.name, label]));

  const reviewerChoices: BoardAuthor[] = [];
  const seenReviewers = new Set<string>();
  for (const reviewer of [...reviewers, ...(reviewerOptions ?? [])]) {
    const key = reviewer.login.toLowerCase();
    if (!seenReviewers.has(key)) {
      seenReviewers.add(key);
      reviewerChoices.push(reviewer);
    }
  }
  const reviewerByKey = new Map(reviewerChoices.map((reviewer) => [reviewer.login.toLowerCase(), reviewer]));
  const canSubmitComment = detail.canComment && !busy && draft.trim().length > 0;
  const submitComment = () => {
    if (!canSubmitComment) {
      return;
    }
    onComment(draft.trim());
    setDraft('');
  };

  return (
    <div className="detail">
      <header className="detail__header">
        <div className="detail__kicker">
          <StateBadge kind={detail.kind} state={detail.state} draft={detail.draft} />
          {detail.checks && detail.checks.total > 0 ? (
            <button
              type="button"
              className={`checks-pill checks-pill--${checksTone(detail.checks)}`}
              title="View checks"
              aria-label={`View checks: ${detail.checks.passed} of ${detail.checks.total} passed`}
              onClick={onOpenChecks}
            >
              <span className="checks-pill__dot" />
              {detail.checks.passed}/{detail.checks.total} checks passed
            </button>
          ) : null}
          <span className="detail__ref">
            {repoLabel ? `${repoLabel} ` : ''}
            <span className="detail__number">#{detail.number}</span>
          </span>
          <div className="detail__actions">
            <button
              type="button"
              className="icon-btn"
              title="Refresh"
              aria-label="Refresh"
              onClick={onRefresh}
            >
              <Icon name="refresh" />
            </button>
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
              ? detail.labels.map((label) => <LabelChip key={label.name} {...label} />)
              : <span className="meta__none">None</span>}
            {detail.canEditLabels ? (
              labelOptions === null ? (
                <span className="meta__note">Loading labels…</span>
              ) : labelOptions.length === 0 ? (
                <span className="meta__note">No labels available</span>
              ) : (
                <MultiSelect
                  ariaLabel="Edit labels"
                  disabled={busy}
                  options={labelChoices.map((label) => ({
                    key: label.name,
                    label: label.name,
                    node: <LabelChip name={label.name} color={label.color} />
                  }))}
                  selected={detail.labels.map((label) => label.name)}
                  searchPlaceholder="Filter labels…"
                  emptyMatchText="No matching labels"
                  renderChip={(key, remove) => {
                    const label = labelByKey.get(key);
                    return label ? <LabelChip {...label} onRemove={remove} disabled={busy} /> : null;
                  }}
                  onApply={onSetLabels}
                />
              )
            ) : null}
          </dd>
          {detail.reviewers || detail.canEditReviewers ? (
            <>
              <dt>Reviewers</dt>
              <dd>
                {reviewers.length > 0
                  ? reviewers.map((reviewer) => <ReviewerChip key={reviewer.login} author={reviewer} />)
                  : <span className="meta__none">None</span>}
                {detail.canEditReviewers ? (
                  reviewerOptions === null ? (
                    <span className="meta__note">Loading reviewers…</span>
                  ) : reviewerOptions.length === 0 ? (
                    <span className="meta__note">No reviewer candidates</span>
                  ) : (
                    <MultiSelect
                      ariaLabel="Edit reviewers"
                      disabled={busy}
                      options={reviewerChoices.map((reviewer) => ({
                        key: reviewer.login.toLowerCase(),
                        label: reviewer.login,
                        node: (
                          <span className="picker__person">
                            <Avatar author={reviewer} small />
                            <span className="picker__login">{reviewer.login}</span>
                          </span>
                        )
                      }))}
                      selected={reviewers.map((reviewer) => reviewer.login.toLowerCase())}
                      searchPlaceholder="Filter reviewers…"
                      emptyMatchText="No matching reviewers"
                      renderChip={(key, remove) => {
                        const reviewer = reviewerByKey.get(key);
                        return reviewer ? <ReviewerChip author={reviewer} onRemove={remove} disabled={busy} /> : null;
                      }}
                      onApply={(keys) => onSetReviewers(keys.map((key) => reviewerByKey.get(key)?.login ?? key))}
                    />
                  )
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>

        <Markdown body={detail.body || '_No description._'} />

        {reviewThreads.length > 0 ? (
          <section className="threads" aria-label="Review threads">
            <h2>
              Review threads
              <span className="threads__count">{reviewThreads.length}</span>
            </h2>
            {reviewThreads.map((thread) => (
              <article key={thread.id} className="thread">
                <header className="thread__head">
                  <code className="thread__path">
                    {thread.path ?? 'General'}
                    {thread.line != null ? `:${thread.line}` : ''}
                  </code>
                  <span className={`thread__badge${thread.resolved ? ' thread__badge--resolved' : ''}`}>
                    {thread.resolved ? 'Resolved' : 'Unresolved'}
                  </span>
                  <span className="thread__count">
                    {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
                  </span>
                </header>
                {thread.comments.map((comment) => <CommentView key={comment.id} comment={comment} />)}
                <ThreadReply threadId={thread.id} busy={busy} onReply={onReply} />
              </article>
            ))}
          </section>
        ) : null}

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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitComment();
                  }
                }}
              />
            </div>
          ) : (
            <p className="detail__closed">Comments are not available for this item.</p>
          )}
          <div className="detail__footerbar">
            {actions || detail.canReview ? (
              <div className="detail__itemactions">
                {detail.canClose ? (
                  <CloseMenu kind={detail.kind} reasons={closeReasons} disabled={busy} onCloseState={(reason) => onSetState('closed', reason)} />
                ) : null}
                {detail.canReopen ? (
                  <button type="button" className="btn" disabled={busy} onClick={() => onSetState('open')}>Reopen</button>
                ) : null}
                {detail.canMarkReady ? (
                  <button type="button" className="btn" disabled={busy} onClick={onMarkReady}>Ready for review</button>
                ) : null}
                {detail.canMerge ? (
                  <MergeButton
                    methods={mergeMethods}
                    method={mergeMethod}
                    disabled={busy}
                    onSelectMethod={onMergeMethodChange}
                    onMerge={onMerge}
                  />
                ) : null}
                {detail.canReview ? (
                  detail.reviewModel === 'votes' ? (
                    <div className="votes">
                      {voteLabels.length === 0 ? (
                        <span className="detail__note">No vote labels available.</span>
                      ) : (
                        voteLabels.map((label) => (
                          <div className="votes__row" key={label.name}>
                            <span className="votes__label" title={label.name}>{label.name}</span>
                            <span className="votes__values">
                              {[...label.permitted].sort((left, right) => left - right).map((value) => {
                                const description = label.values.find((entry) => entry.value === value)?.description;
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    className={`votes__value${votes[label.name] === value ? ' votes__value--active' : ''}`}
                                    title={description ?? undefined}
                                    aria-pressed={votes[label.name] === value}
                                    disabled={busy}
                                    onClick={() => setVotes((current) => {
                                      const next = { ...current };
                                      if (next[label.name] === value) delete next[label.name];
                                      else next[label.name] = value;
                                      return next;
                                    })}
                                  >
                                    {value > 0 ? `+${value}` : value}
                                  </button>
                                );
                              })}
                            </span>
                            {label.votes.filter((vote) => vote.value !== 0).length > 0 ? (
                              <span className="votes__cast">
                                {label.votes.filter((vote) => vote.value !== 0).map((vote) => `${vote.user.login} ${vote.value > 0 ? '+' : ''}${vote.value}`).join(', ')}
                              </span>
                            ) : null}
                          </div>
                        ))
                      )}
                      <button
                        className="btn btn--primary"
                        disabled={busy || Object.keys(votes).length === 0}
                        onClick={() => { onVote(votes); setVotes({}); }}
                      >
                        Vote
                      </button>
                    </div>
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
              <button className="btn btn--primary" disabled={!canSubmitComment} onClick={submitComment}>
                Comment
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function TrackerStateField({
  detail,
  states,
  loading,
  error,
  disabled,
  onSetState
}: {
  detail: BoardTrackerDetail;
  states: BoardTrackerState[];
  loading: boolean;
  error?: string;
  disabled: boolean;
  onSetState: (itemId: string, stateId: string) => void;
}) {
  if (!detail.container) {
    return <span>{detail.state ? detail.state.name : 'None'}</span>;
  }

  const currentValue =
    detail.state?.id ?? states.find((state) => state.name === detail.state?.name)?.id ?? detail.state?.name ?? '';
  const known = states.some((state) => (state.id ?? state.name) === currentValue);

  return (
    <>
      <select
        className="select state-select"
        value={known ? currentValue : ''}
        aria-label="Change state"
        disabled={disabled || loading || states.length === 0}
        onChange={(event) => {
          if (event.target.value) {
            onSetState(detail.id, event.target.value);
          }
        }}
      >
        {known ? null : <option value="">{detail.state?.name ?? 'No state'}</option>}
        {states.map((state) => (
          <option key={state.id ?? state.name} value={state.id ?? state.name}>
            {state.name}
          </option>
        ))}
      </select>
      {loading ? <span className="meta__note">Loading states…</span> : null}
      {error ? <span className="meta__note error">{error}</span> : null}
    </>
  );
}

function TrackerWorkspace({
  items,
  detail,
  selected,
  loading,
  error,
  hasMore,
  narrow,
  listOpen,
  listWidth,
  states,
  statesLoading,
  statesError,
  busy,
  onListWidthChange,
  onCloseList,
  onSelect,
  onLoadMore,
  onSetState,
  onOpen,
  onComment
}: {
  items: BoardTrackerItem[];
  detail: BoardTrackerDetail | null;
  selected: string | null;
  loading: boolean;
  error?: string;
  hasMore: boolean;
  narrow: boolean;
  listOpen: boolean;
  listWidth: number | null;
  states: BoardTrackerState[];
  statesLoading: boolean;
  statesError?: string;
  busy: boolean;
  onListWidthChange: (width: number) => void;
  onCloseList: () => void;
  onSelect: (item: BoardTrackerItem) => void;
  onLoadMore: () => void;
  onSetState: (itemId: string, stateId: string) => void;
  onOpen: (url: string) => void;
  onComment: (identifier: string, body: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <Workspace
      narrow={narrow}
      listOpen={listOpen}
      listWidth={listWidth}
      onListWidthChange={onListWidthChange}
      onCloseList={onCloseList}
      list={
        <TrackerList
          items={items}
          selected={selected}
          loading={loading}
          error={error}
          hasMore={hasMore}
          onSelect={onSelect}
          onLoadMore={onLoadMore}
        />
      }
      detail={
        <>
          {error ? <ErrorState message={error} variant="detail" /> : null}
          {!detail ? (
            <div className="detail detail--empty">
              {loading ? <Loading /> : 'Select a work item to preview it.'}
            </div>
          ) : (
            <div className="detail">
              <header className="detail__header">
                <div className="detail__kicker">
                  <span className="detail__ref"><span className="detail__number">{detail.identifier}</span></span>
                  <div className="detail__actions">
                    <button className="ghost-link" type="button" onClick={() => onOpen(detail.url)}>
                      Open<Icon name="external" />
                    </button>
                  </div>
                </div>
                <h1 className="detail__title">{detail.title}</h1>
              </header>
              <div className="detail__body">
                <dl className="meta">
                  <dt>State</dt>
                  <dd>
                    <TrackerStateField
                      detail={detail}
                      states={states}
                      loading={statesLoading}
                      error={statesError}
                      disabled={busy || loading}
                      onSetState={onSetState}
                    />
                  </dd>
                  <dt>Priority</dt>
                  <dd>{detail.priority}</dd>
                  <dt>Assignee</dt>
                  <dd>{detail.assignee ? detail.assignee.login : 'None'}</dd>
                  {detail.container ? (<><dt>Project</dt><dd>{detail.container.name}</dd></>) : null}
                  <dt>Labels</dt>
                  <dd>{detail.labels.length > 0 ? detail.labels.map((label) => <LabelChip key={label.name} {...label} />) : <span className="meta__none">None</span>}</dd>
                </dl>
                <Markdown body={detail.description || '_No description._'} />
                <section className="comments">
                  <h2>{detail.comments.length} comment{detail.comments.length === 1 ? '' : 's'}</h2>
                  {detail.comments.map((comment) => <CommentView key={comment.id} comment={comment} />)}
                  <div className="composer">
                    <textarea
                      value={draft}
                      aria-label="Comment on this work item"
                      placeholder="Leave a comment…"
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  </div>
                  <div className="detail__footerbar">
                    <button
                      className="btn btn--primary"
                      disabled={busy || !draft.trim()}
                      onClick={() => {
                        const body = draft.trim();
                        if (!body) {
                          return;
                        }
                        onComment(detail.identifier, body);
                        setDraft('');
                      }}
                    >
                      Comment
                    </button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </>
      }
    />
  );
}

export function App() {
  const [repo, setRepo] = useState<BoardRepoInfo | null>(null);
  const [providers, setProviders] = useState<BoardProviderInfo[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [trackers, setTrackers] = useState<BoardProviderInfo[]>([]);
  const [trackerId, setTrackerId] = useState<string | null>(null);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerState, setTrackerState] = useState('open');
  const [trackerItems, setTrackerItems] = useState<BoardTrackerItem[]>([]);
  const [trackerDetail, setTrackerDetail] = useState<BoardTrackerDetail | null>(null);
  const [trackerSelected, setTrackerSelected] = useState<string | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState<string | undefined>();
  const [trackerCursor, setTrackerCursor] = useState<string | null>(null);
  const [trackerHasMore, setTrackerHasMore] = useState(false);
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
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>(readStoredMergeMethod);
  const [checksOpen, setChecksOpen] = useState(false);
  const [checks, setChecks] = useState<BoardCheck[] | null>(null);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksError, setChecksError] = useState<string | undefined>();
  const [trackerStates, setTrackerStates] = useState<BoardTrackerState[]>([]);
  const [trackerStatesLoading, setTrackerStatesLoading] = useState(false);
  const [trackerStatesError, setTrackerStatesError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [narrow, setNarrow] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listWidth, setListWidth] = useState<number | null>(readStoredListWidth);
  const appRef = useRef<HTMLDivElement>(null);
  const sourceListRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const detailKey = useRef<string | null>(null);
  const labelsRequest = useRef(0);
  const reviewersRequest = useRef(0);
  const trackerRequest = useRef(0);
  const trackerDetailRequest = useRef(0);
  const checksRequest = useRef(0);
  const trackerStatesRequest = useRef(0);
  const trackerStatesContainer = useRef<string | null>(null);
  const trackerOpenRef = useRef(false);
  const activeProvider = useRef<string | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const node = appRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver(() => setNarrow(node.getBoundingClientRect().width < NARROW_BREAKPOINT));
    observer.observe(node);
    setNarrow(node.getBoundingClientRect().width < NARROW_BREAKPOINT);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    trackerOpenRef.current = trackerOpen;
  }, [trackerOpen]);

  useEffect(() => {
    if (narrow) {
      return;
    }
    setListOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (!listOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setListOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listOpen]);

  useEffect(() => {
    if (listWidth === null) {
      return;
    }
    try {
      window.localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(listWidth)));
    } catch {
      // Persisting the split width is best-effort.
    }
  }, [listWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MERGE_METHOD_KEY, mergeMethod);
    } catch {
      // Persisting the merge method is best-effort.
    }
  }, [mergeMethod]);

  useEffect(() => {
    setChecksOpen(false);
    setChecks(null);
    setChecksError(undefined);
    setChecksLoading(false);
    checksRequest.current = 0;
  }, [selected]);

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
        setTrackers(message.trackers ?? []);
        setTrackerId(message.trackerId ?? null);
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
      if (message.type === 'trackerList') {
        if (message.requestId !== trackerRequest.current) {
          return;
        }
        setTrackerItems((current) => (message.result.cursor && current.length > 0 ? [...current, ...message.result.items] : message.result.items));
        setTrackerCursor(message.result.cursor);
        setTrackerHasMore(message.result.hasMore);
        setTrackerLoading(false);
        setTrackerError(undefined);
        return;
      }
      if (message.type === 'trackerDetail') {
        // requestId 0 is an unsolicited reload (for example after a state write).
        if (message.requestId !== 0 && message.requestId !== trackerDetailRequest.current) {
          return;
        }
        const next = message.detail;
        setTrackerDetail(next);
        setTrackerLoading(false);
        setTrackerError(message.error);
        const containerId = next?.container?.id ?? null;
        if (containerId && containerId !== trackerStatesContainer.current) {
          trackerStatesContainer.current = containerId;
          trackerStatesRequest.current = ++requestId.current;
          setTrackerStates([]);
          setTrackerStatesError(undefined);
          setTrackerStatesLoading(true);
          post({ type: 'trackerStates', requestId: trackerStatesRequest.current, containerId });
        } else if (!containerId && trackerStatesContainer.current !== null) {
          trackerStatesContainer.current = null;
          trackerStatesRequest.current = 0;
          setTrackerStates([]);
          setTrackerStatesError(undefined);
          setTrackerStatesLoading(false);
        }
        return;
      }
      if (message.type === 'checks') {
        if (message.requestId !== checksRequest.current) {
          return;
        }
        setChecks(message.checks);
        setChecksError(message.error);
        setChecksLoading(false);
        return;
      }
      if (message.type === 'trackerStates') {
        if (message.requestId !== trackerStatesRequest.current) {
          return;
        }
        setTrackerStates(message.states);
        setTrackerStatesError(message.error);
        setTrackerStatesLoading(false);
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
        if (trackerOpenRef.current) {
          setTrackerError(message.message);
        } else {
          setListError(message.message);
          setDetailError(message.message);
        }
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
    setListOpen(false);
    setSelected(item.number);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(undefined);
    const id = ++requestId.current;
    detailRequest.current = id;
    post({ type: 'detail', requestId: id, kind: item.kind, number: item.number });
  };

  const loadTracker = (state: string, append: boolean) => {
    if (!trackerId) {
      return;
    }
    const id = ++requestId.current;
    trackerRequest.current = id;
    setTrackerLoading(true);
    if (!append) {
      setTrackerError(undefined);
      setTrackerItems([]);
      setTrackerDetail(null);
      setTrackerSelected(null);
      trackerStatesContainer.current = null;
      trackerStatesRequest.current = 0;
      setTrackerStates([]);
      setTrackerStatesError(undefined);
      setTrackerStatesLoading(false);
    }
    post({ type: 'trackerList', requestId: id, state, cursor: append ? trackerCursor : null });
  };

  useEffect(() => {
    if (trackerOpen && trackerId) {
      loadTracker(trackerState, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackerOpen, trackerId, trackerState]);

  const selectTrackerItem = (item: BoardTrackerItem) => {
    setListOpen(false);
    setTrackerSelected(item.id);
    setTrackerDetail(null);
    setTrackerLoading(true);
    const id = ++requestId.current;
    trackerDetailRequest.current = id;
    post({ type: 'trackerDetail', requestId: id, id: item.id });
  };

  const requestChecks = (number: number) => {
    const id = ++requestId.current;
    checksRequest.current = id;
    setChecksLoading(true);
    setChecksError(undefined);
    post({ type: 'checks', requestId: id, number });
  };

  const openChecks = (number: number) => {
    setChecksOpen(true);
    setChecks(null);
    setChecksError(undefined);
    requestChecks(number);
  };

  const kinds = repo?.kinds ?? (['issue', 'pull', 'discussion'] as BoardKind[]);

  useEffect(() => {
    if (!kinds.includes(kind)) {
      setKind(kinds[0] ?? 'issue');
    }
  }, [kinds, kind]);

  useEffect(() => {
    if (!repo && trackers.length > 0) {
      setTrackerOpen(true);
    }
  }, [repo, trackers.length]);

  const repoLabel = repo ? `${repo.owner}/${repo.name}` : '';
  const activeListLabel = trackerOpen
    ? trackerDetail?.title ?? trackerItems.find((item) => item.id === trackerSelected)?.title ?? 'Select an item'
    : detail?.title ?? items.find((item) => item.number === selected)?.title ?? 'Select an item';

  return (
    <div className="app" ref={appRef}>
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

      {!repo && trackers.length === 0 ? (
        <div className="empty">
          <h2>No supported remote</h2>
          <p>This repository has no supported Git host remote. Add one, or install an OpenChamber integration provider.</p>
        </div>
      ) : !authenticated && !trackerOpen ? (
        <div className="empty">
          <h2>Connect {repo?.providerLabel ?? 'provider'}</h2>
          <p>Git Studio needs a token with repository read access to list issues, pull requests and discussions.</p>
          {stateError ? <p className="error">{stateError}</p> : null}
          <button className="btn btn--primary" onClick={() => post({ type: 'connectProvider', providerId: providerId ?? 'github' })}>
            Connect {repo?.providerLabel ?? 'provider'}
          </button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Item kind">
              {repo && authenticated ? kinds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={!trackerOpen && kind === entry}
                  className={`tab${!trackerOpen && kind === entry ? ' tab--active' : ''}`}
                  onClick={() => { setListOpen(false); setTrackerOpen(false); setKind(entry); }}
                >
                  <Icon name={kindIconName(entry)} className="tab__icon" />
                  {KIND_LABEL[entry]}
                </button>
              )) : null}
              {trackers.length > 0 ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={trackerOpen}
                  className={`tab${trackerOpen ? ' tab--active' : ''}`}
                  onClick={() => { setListOpen(false); setTrackerOpen(true); }}
                >
                  <Icon name="record" className="tab__icon" />
                  Tracker
                </button>
              ) : null}
            </div>
            {repo ? (
              <span className="scope" title={repoLabel}>
                <Icon name="repo" className="scope__icon" />
                <span className="scope__label">{repoLabel}</span>
              </span>
            ) : null}
            <div className="toolbar__right">
              {narrow ? (
                <button
                  type="button"
                  className="list-trigger"
                  aria-expanded={listOpen}
                  aria-controls="board-list-overlay"
                  title={activeListLabel}
                  onClick={() => setListOpen((open) => !open)}
                >
                  <Icon name="list" className="list-trigger__icon" />
                  <span className="list-trigger__label">{activeListLabel}</span>
                  <Icon name="chevron" className="list-trigger__chevron" />
                </button>
              ) : null}
              {trackerOpen ? (
                <div className="filter">
                  <select
                    value={trackerState}
                    aria-label="Filter work items by state"
                    onChange={(event) => setTrackerState(event.target.value)}
                  >
                    <option value="open">Open</option>
                    <option value="all">All</option>
                    <option value="todo">Todo</option>
                    <option value="in-progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                  <Icon name="chevron" className="filter__chevron" />
                </div>
              ) : (
                <>
                  <label className="search">
                    <Icon name="search" className="search__icon" />
                    <input
                      value={search}
                      placeholder={`Search ${KIND_LABEL[kind].toLowerCase()}…`}
                      aria-label={`Search ${KIND_LABEL[kind].toLowerCase()}`}
                      onChange={(event) => onSearchChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          if (narrow) {
                            setListOpen(true);
                          } else {
                            sourceListRef.current?.focus();
                          }
                        } else if (event.key === 'Escape') {
                          event.stopPropagation();
                          if (search) {
                            event.preventDefault();
                            onSearchChange('');
                          } else {
                            event.currentTarget.blur();
                          }
                        }
                      }}
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
                </>
              )}
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

          {trackerOpen ? (
            <TrackerWorkspace
              items={trackerItems}
              detail={trackerDetail}
              selected={trackerSelected}
              loading={trackerLoading}
              error={trackerError}
              hasMore={trackerHasMore}
              narrow={narrow}
              listOpen={listOpen}
              listWidth={listWidth}
              states={trackerStates}
              statesLoading={trackerStatesLoading}
              statesError={trackerStatesError}
              busy={busy}
              onListWidthChange={setListWidth}
              onCloseList={() => setListOpen(false)}
              onSelect={selectTrackerItem}
              onLoadMore={() => loadTracker(trackerState, true)}
              onSetState={(itemId, stateId) => post({ type: 'trackerSetState', itemId, stateId })}
              onOpen={(url) => post({ type: 'openExternal', url })}
              onComment={(identifier, body) => post({ type: 'trackerComment', identifier, body })}
            />
          ) : (
            <Workspace
              narrow={narrow}
              listOpen={listOpen}
              listWidth={listWidth}
              onListWidthChange={setListWidth}
              onCloseList={() => setListOpen(false)}
              list={
                <SourceList
                  kind={kind}
                  items={items}
                  selected={selected}
                  loading={listLoading}
                  error={listError}
                  hasMore={hasMore}
                  listRef={sourceListRef}
                  onSelect={selectItem}
                  onLoadMore={() => {
                    const next = page + 1;
                    setPage(next);
                    loadList(next, true);
                  }}
                />
              }
              detail={
                <>
                  {detailError ? <ErrorState message={detailError} variant="detail" /> : null}
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
                mergeMethod={mergeMethod}
                onMergeMethodChange={setMergeMethod}
                onComment={(body) => {
                  if (selected == null) return;
                  post({ type: 'comment', kind, number: selected, body });
                }}
                onSetState={(state, reason) => {
                  if (selected == null) return;
                  post({ type: 'setState', kind, number: selected, state, reason });
                }}
                onMerge={(method) => {
                  if (selected == null) return;
                  post({ type: 'merge', number: selected, method });
                }}
                onMarkReady={() => {
                  if (selected == null) return;
                  post({ type: 'markReady', number: selected });
                }}
                onOpenChecks={() => {
                  if (detail == null) return;
                  openChecks(detail.number);
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
                onVote={(votes) => {
                  if (selected == null) return;
                  post({ type: 'review', number: selected, votes });
                }}
                onReply={(threadId, body) => post({ type: 'reviewReply', threadId, body })}
                    onOpen={(url) => post({ type: 'openExternal', url })}
                    onCopy={(text) => post({ type: 'copy', text })}
                    onRefresh={() => post({ type: 'refresh' })}
                  />
                </>
              }
            />
          )}
        </>
      )}
      {checksOpen ? (
        <ChecksDialog
          title={detail?.title ?? 'Pull request'}
          checks={checks}
          loading={checksLoading}
          error={checksError}
          onClose={() => setChecksOpen(false)}
          onRefresh={() => {
            if (detail) {
              requestChecks(detail.number);
            }
          }}
          onOpen={(url) => post({ type: 'openExternal', url })}
        />
      ) : null}
    </div>
  );
}
