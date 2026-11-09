# Diffs and comparisons

All compare commands open the native diff editor. Multi-file commits use `vscode.changes`; a single
file uses `vscode.diff`. When the right side is the working tree it is a real `file:` URI, so edits and
saves land in the workspace.

## Command semantics

| Command | Git equivalent | Notes |
| --- | --- | --- |
| Compare Working Tree with Merge Base… | `git diff $(git merge-base <ref> HEAD)` → working tree | Three-dot semantics. Untracked files appear as additions. Right side is editable. |
| Compare Current Branch with Merge Base… | `merge-base(ref, HEAD)` → `HEAD` | Three-dot. In detached HEAD, uses the only containing branch, asks when several match, or falls back to HEAD. |
| Compare Two Refs… | `git diff A B` | Two-dot, full trees. Both sides read-only. |
| Compare Two Refs with Merge Base… | `git diff $(git merge-base A B) B` | Three-dot. Only changes on B since divergence. |
| Compare Stash… | parent ↔ stash | Parses `git stash list`; uses `stash@{n}^1`. |
| Compare File at Two Revisions… | `<rev>:<path>` ↔ `<rev>:<path>` | Missing side opens an empty document. |
| Compare Folder with Working Tree… | merge-base → folder | Same three-dot baseline as working tree. |
| Compare Unpushed Commits… | `@{upstream}..HEAD` | Pre-push self-check. |
| Compare Incoming Commits… | `HEAD..@{upstream}` | Preview what a pull would bring. |
| Compare Tag with Previous Tag… | previous tag ↔ tag | Previous tag by creation date. |
| Compare Against Remote Tracking Branch… | `HEAD...<remote>` either direction | Direction is selectable. |
| Compare with Reflog Entry… | reflog OID ↔ HEAD | One-off inspection. |

`Compare Working Tree` and `Compare Folder` include uncommitted and untracked files; the other
commands compare committed trees only.

## Ref picker

Every command opens the same grouped picker:

1. inferred base branch (lightbulb)
2. mainlines (excluding the inferred entry)
3. Branches: local branches plus remote-only branches; remote counterparts of a local branch are
   exposed as per-item cloud buttons
4. Tags
5. `Custom revision…`

The picker opens immediately and fills asynchronously, so large repositories do not block the UI.
Lists are capped and `Show all refs…` loads the rest.

### Base-branch inference

Inference only uses branch relationships; it never consults the mainline list.

1. Tracking upstream, unless it is the same-named remote branch.
2. `branch: Created from <ref>` in the branch reflog.
3. The closest fork point among the 20 most recently updated local/remote branches:
   `git rev-list --count --left-right HEAD...<candidate>`.
   - candidates are ranked by `currentAhead` ascending;
   - then by the candidate's last commit descending;
   - then by name.

The candidate's own ahead count is informational only: a base branch is allowed to advance past the
fork point. A candidate at the exact same commit is skipped; a local branch strictly ahead of the
current branch is treated as a child, while a remote branch may legitimately be ahead.

### Mainlines

If any `refs/remotes/<remote>/HEAD` exists, the mainline set is exactly those remote default branches.
Otherwise it falls back to branches named `main` or `master`. Mainlines are ordered by last commit.

`HEAD` is never offered by **Compare Current Branch with Merge Base** (it would compare a branch with
itself). **Compare Working Tree with Merge Base** keeps `HEAD` after the mainlines because it means
"only uncommitted changes".

## Three-dot vs two-dot

- `A...B` compares the merge base to `B`, so commits unique to `A` never appear as reverse diffs.
- `A B` compares the two full trees and shows both directions.

Use **Compare Two Refs…** for "how do these branches differ overall"; use the merge-base variants for
"what changed on this side since we diverged".
