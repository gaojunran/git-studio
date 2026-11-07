import { useEffect, useState } from 'react';
import type { RebaseAction, RebaseItem, RebasePlan } from '../../shared/protocol';

interface Props {
  plan: RebasePlan | null;
  onClose: () => void;
  onStart: (plan: RebasePlan) => void;
}

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

function planError(items: RebaseItem[]): string | undefined {
  const kept = items.filter((item) => item.action !== 'drop');
  if (kept.length === 0) {
    return 'Keep at least one commit.';
  }
  if (kept[0].action === 'squash' || kept[0].action === 'fixup') {
    return 'The first kept commit cannot be squashed or fixed up.';
  }
  if (items.some((item) => item.action === 'reword' && !(item.message ?? item.subject).trim())) {
    return 'Every reword needs a message.';
  }
  return undefined;
}

export function RebaseDialog(props: Props) {
  const { plan, onClose, onStart } = props;
  const [items, setItems] = useState<RebaseItem[]>([]);

  useEffect(() => {
    setItems(plan?.items.map((item) => ({ ...item, message: item.message ?? item.subject })) ?? []);
  }, [plan]);

  useEffect(() => {
    if (!plan) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, onClose]);

  if (!plan) {
    return null;
  }

  const error = plan.error ?? planError(items);

  const update = (index: number, patch: Partial<RebaseItem>) => {
    setItems((previous) => previous.map((item, current) => (current === index ? { ...item, ...patch } : item)));
  };

  const move = (index: number, delta: number) => {
    setItems((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Interactive rebase">
        <div className="dialog__header">
          <span>Interactive rebase</span>
          <span className="dialog__subtitle">
            {plan.branch ?? 'HEAD'} onto {plan.targetShort}
          </span>
        </div>

        {plan.error ? (
          <>
            <div className="dialog__error">{plan.error}</div>
            <div className="dialog__footer">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog__hint">
              Oldest first. `squash`/`fixup` fold into the commit above; `drop` removes the commit. Merge commits are
              flattened.
            </div>

            <div className="rebase-list">
              {items.map((item, index) => (
                <div className="rebase-item" key={item.hash}>
                  <div className="rebase-row">
                    <select
                      className="rebase-row__action"
                      value={item.action}
                      onChange={(event) => update(index, { action: event.target.value as RebaseAction })}
                    >
                      {ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </select>

                    <div className="rebase-row__move">
                      <button
                        type="button"
                        className="btn btn--tiny"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--tiny"
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1)}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>

                    <div className="rebase-row__text">
                      <div className="rebase-row__subject">{item.subject || '(no message)'}</div>
                      <div className="rebase-row__hash">{item.shortHash}</div>
                    </div>
                  </div>

                  {item.action === 'reword' && (
                    <input
                      className="rebase-row__message"
                      value={item.message ?? item.subject}
                      onChange={(event) => update(index, { message: event.target.value })}
                      spellCheck={false}
                    />
                  )}
                </div>
              ))}
            </div>

            {error && <div className="dialog__error">{error}</div>}

            <div className="dialog__footer">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={Boolean(error)}
                onClick={() => onStart({ ...plan, items })}
              >
                Start Rebase
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
