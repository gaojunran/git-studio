import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { RefInfo } from '../../shared/protocol';

export type BranchAction = 'checkout' | 'create' | 'delete' | 'rename' | 'merge' | 'rebase' | 'favorite';

interface Props {
  refs: RefInfo[];
  favorites: Set<string>;
  currentBranch: string | null;
  allRepos: boolean;
  onAllRepos: (enabled: boolean) => void;
  onAction: (action: BranchAction, ref: RefInfo) => void;
}

interface MenuState {
  ref: RefInfo;
  x: number;
  y: number;
}

const STORAGE_KEY = 'gitStudio.branchesCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isCurrentRef(ref: RefInfo, currentBranch: string | null): boolean {
  return ref.current || (ref.type !== 'remote' && ref.type !== 'tag' && ref.shortName === currentBranch);
}

function syncTitle(ref: RefInfo): string {
  const upstream = ref.upstream ?? 'upstream';
  const parts: string[] = [];
  if (ref.ahead) {
    parts.push(`${ref.ahead} ahead of ${upstream}`);
  }
  if (ref.behind) {
    parts.push(`${ref.behind} behind ${upstream}`);
  }
  return parts.join(', ');
}

export function BranchesSidebar(props: Props) {
  const { refs, favorites, currentBranch, allRepos } = props;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(() => {
    const local: RefInfo[] = [];
    const remote: RefInfo[] = [];
    const tags: RefInfo[] = [];
    for (const ref of refs) {
      if (ref.type === 'remote') {
        remote.push(ref);
      } else if (ref.type === 'tag') {
        tags.push(ref);
      } else {
        local.push(ref);
      }
    }
    const favoriteRefs = refs.filter((ref) => favorites.has(ref.name));
    return [
      { id: 'favorites', label: 'Favorites', items: favoriteRefs, hint: 'Star a branch to pin it here.' },
      { id: 'local', label: 'Local', items: local },
      { id: 'remote', label: 'Remote', items: remote },
      { id: 'tags', label: 'Tags', items: tags }
    ];
  }, [refs, favorites]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? '0' : '1');
      } catch {
        // Ignore storage failures; the sidebar still collapses for this session.
      }
      return !value;
    });
  };

  const openMenu = (ref: RefInfo, x: number, y: number) => {
    setMenu({ ref, x, y });
  };

  const runAction = (action: BranchAction) => {
    if (!menu) {
      return;
    }
    setMenu(null);
    props.onAction(action, menu.ref);
  };

  const menuRef_ = menu?.ref;
  const menuFavorite = menuRef_ ? favorites.has(menuRef_.name) : false;
  const menuItems: { action: BranchAction; label: string; disabled?: boolean; danger?: boolean; note?: string }[] = menuRef_
    ? [
        { action: 'create', label: 'Create Branch Here…' },
        {
          action: 'rename',
          label: 'Rename…',
          disabled: menuRef_.type === 'remote' || menuRef_.type === 'tag',
          note: 'Only local branches can be renamed'
        },
        {
          action: 'delete',
          label: 'Delete',
          disabled: menuRef_.type === 'remote' || menuRef_.type === 'tag',
          danger: true,
          note: 'Only local branches can be deleted'
        },
        { action: 'merge', label: 'Merge into Current' },
        { action: 'rebase', label: 'Rebase Current onto This' },
        { action: 'favorite', label: menuFavorite ? 'Unfavorite' : 'Favorite' }
      ]
    : [];

  if (collapsed) {
    return (
      <aside className="branches branches--collapsed">
        <button className="branches__expand" onClick={toggleCollapsed} title="Show branches" aria-label="Show branches">
          ›
        </button>
        <span className="branches__rail">Branches</span>
        {allRepos && <span className="branches__rail-dot" title="All repositories" />}
      </aside>
    );
  }

  return (
    <aside className="branches">
      <div className="branches__head">
        <span className="branches__title">Branches</span>
        <span className="branches__count" title={`${refs.length} refs`}>
          {refs.length}
        </span>
        <button className="branches__collapse" onClick={toggleCollapsed} title="Collapse branches" aria-label="Collapse branches">
          ‹
        </button>
      </div>

      <div className="branches__all">
        <button
          role="switch"
          aria-checked={allRepos}
          className={`switch ${allRepos ? 'switch--on' : ''}`}
          onClick={() => props.onAllRepos(!allRepos)}
          title="Show commits from every repository in this workspace"
        >
          <span className="switch__knob" />
        </button>
        <span className="branches__all-label">All repositories</span>
      </div>

      <div className="branches__scroll">
        {groups.map((group) => (
          <section className={`branch-group branch-group--${group.id}`} key={group.id}>
            <div className="branch-group__head">
              <span className="branch-group__label">{group.label}</span>
              {group.items.length > 0 && <span className="branch-group__count">{group.items.length}</span>}
            </div>
            {group.items.length === 0 ? (
              group.hint && group.id === 'favorites' ? <div className="branch-group__hint">{group.hint}</div> : null
            ) : (
              group.items.map((ref) => {
                const current = isCurrentRef(ref, currentBranch);
                const favorite = favorites.has(ref.name);
                return (
                  <div
                    key={`${group.id}-${ref.name}`}
                    className={`branch-row ${current ? 'branch-row--current' : ''}`}
                    role="button"
                    tabIndex={0}
                    title={`${ref.shortName} · click to checkout`}
                    onClick={() => props.onAction('checkout', ref)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        props.onAction('checkout', ref);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(ref, event.clientX, event.clientY);
                    }}
                  >
                    <span className={`branch-row__mark ${current ? 'branch-row__mark--on' : ''}`} aria-hidden="true">
                      {current ? '●' : ''}
                    </span>
                    <span className="branch-row__name">{ref.shortName}</span>
                    {Boolean(ref.ahead || ref.behind) && (
                      <span className="branch-row__sync" title={syncTitle(ref)}>
                        {ref.ahead ? <span>↑{ref.ahead}</span> : null}
                        {ref.behind ? <span>↓{ref.behind}</span> : null}
                      </span>
                    )}
                    <button
                      className={`branch-row__star ${favorite ? 'branch-row__star--on' : ''}`}
                      onClick={(event: ReactMouseEvent) => {
                        event.stopPropagation();
                        props.onAction('favorite', ref);
                      }}
                      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-pressed={favorite}
                    >
                      {favorite ? '★' : '☆'}
                    </button>
                    <button
                      className="branch-row__more"
                      onClick={(event: ReactMouseEvent) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        openMenu(ref, rect.right + 4, rect.bottom + 4);
                      }}
                      title="Branch actions"
                      aria-label={`Actions for ${ref.shortName}`}
                      aria-haspopup="menu"
                    >
                      ⋯
                    </button>
                  </div>
                );
              })
            )}
          </section>
        ))}
      </div>

      {menu && menuRef_ && (
        <div
          className="branch-menu"
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${menuRef_.shortName}`}
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 236))
          }}
        >
          <div className="branch-menu__head" title={menuRef_.name}>
            <span className={`branch-menu__kind branch-menu__kind--${menuRef_.type}`}>{menuRef_.type}</span>
            <span className="branch-menu__name">{menuRef_.shortName}</span>
          </div>
          {menuItems.map((item) => (
            <button
              key={item.action}
              role="menuitem"
              className={`branch-menu__item ${item.danger ? 'branch-menu__item--danger' : ''}`}
              disabled={item.disabled}
              title={item.disabled ? item.note : undefined}
              onClick={() => runAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
