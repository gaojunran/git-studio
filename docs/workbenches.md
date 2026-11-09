# Workbenches

The workbenches are editor panels for operations that do not fit naturally into a commit graph.

## Stash workbench

`Git Studio: Stash Workbench…`

- List stashes with message, branch and age.
- Inspect a stash as a native multi-file diff against its parent.
- Apply, pop or drop.
- Create a stash:
  - all changes
  - including untracked files
  - staged only

All writes go through the write coordinator and report conflicts through the shared banner.

## Reflog workbench

`Git Studio: Reflog…`

- Inspect HEAD or any branch reflog.
- Compare a moment with HEAD or any other ref.
- Reset `--hard` to a moment, or restore it on a new branch.
- `Git Studio: Restore HEAD from Reflog…` moves HEAD back one entry.

The rewrite journal is persisted across window reloads; reflog remains the underlying safety net.

## Worktree workbench

`Git Studio: Worktrees…`

- List path, branch, HEAD and dirty state.
- Open a worktree in the current or a new window.
- Create a worktree from any ref.
- Remove a worktree and prune stale entries.

## Patch and export

- **Export Patch…** writes `git diff --binary` for a commit or range.
- **Apply Patch…** applies with `--3way` behind the write coordinator.
- **Export History Graph (SVG)…** writes the first 500 commits as an SVG.

## Write safety

All history/workbench writes share one coordinator per repository:

- operations are serialized;
- an in-progress merge/rebase/cherry-pick/revert blocks new writes;
- the target commit is re-resolved before execution;
- HEAD is checked again after confirmation;
- conflicts surface Continue / Skip / Abort where the operation supports them.
