# Git Studio

IntelliJ-style Git history for VS Code.

Git Studio keeps its surface small on purpose: one History panel plus a few native
editor enhancements. Staging, committing, branches, stashes, worktrees, diffs and
merge conflict resolution stay with the built-in Git extension, so there is only one
place to learn and one source of truth for repository state.

## Features

- Multi-ref commit graph (local branches, remotes, tags, detached HEAD) in an editor panel.
- History filters: message (plain or regex), author, path, date range, ref selection, ordering.
- Bounded loading: 500 commits per page, with virtual scrolling and incremental graph layout.
- Commit details: full message, parents, author/committer, changed files with per-file stats.
- Merge commits: switch the diff base between parent 1 and parent 2.
- Open a commit as a native multi-file diff; compare any two commits.
- File history with rename following (`git log --follow`), opened from Explorer, SCM or the editor.
- Full-file blame annotations with configurable template and clickable commit links.
- Compare the working tree with any branch, tag or commit using three-dot semantics (merge base to
  working tree), so commits unique to the other side never show up. The working-tree side of the diff
  is a real file URI, so it stays editable; untracked files are included as additions.
- Two-ref diffs come in both flavours: `Compare Two Refs` (two-dot, full trees) and
  `Compare Two Refs with Merge Base` (three-dot, right side since divergence).
- More diff commands: two refs, merge-base, stash, one file at two revisions, a folder, and unpushed commits.
- Detached HEAD (jj workflows) is handled: the merge-base command resolves the only branch containing
  HEAD, and asks when several branches match instead of failing.
- Commit actions from the detail pane or a row right-click:
  create branch here, create tag here, checkout (detached), compare with working tree,
  open on GitHub/GitLab/Bitbucket, copy subject or hash.
- History rewriting: reset (soft/mixed/hard), revert and cherry-pick from the same menu.
  Merge commits use parent 1. Conflicts surface in a banner with Abort action.
- Interactive rebase from any ancestor commit: reorder, pick, reword, edit, squash, fixup, drop.
  Merge commits are flattened. The rebase stops for `edit`/conflicts with Continue, Skip and Abort.
- Undo the last Git Studio rewrite from the toolbar. The journal keeps 20 entries per repository
  and is only offered while HEAD still matches the recorded result.
- Write safety: operations are serialized, the target commit is re-resolved, and HEAD is
  rechecked after confirmation; a merge/rebase/cherry-pick/revert in progress blocks new writes.

## Commands

| Command | Description |
| --- | --- |
| `Git Studio: Open History` | Open the history panel for the active repository. |
| `Git Studio: File History` | Show history for a file. |
| `Git Studio: Annotate File (Blame)` | Toggle full-file blame annotations. |
| `Git Studio: Toggle File Annotate` | Toggle annotations for the active editor. |
| `Git Studio: Open Commit in History` | Reveal a commit in the history panel. |
| `Git Studio: Go to Commit…` | Jump to a hash, branch or tag. |
| `Git Studio: Undo Last Rewrite` | Reset back to the state recorded before the last rewrite. |
| `Git Studio: Compare Working Tree with Merge Base…` | Diff a ref against the working tree from their merge base (three-dot). The working-tree side stays editable. |
| `Git Studio: Compare Two Refs…` | Diff any two branches, tags or commits (two-dot, full trees). |
| `Git Studio: Compare Two Refs with Merge Base…` | Diff any two refs from their merge base (three-dot); only changes on the right side appear. |
| `Git Studio: Compare Current Branch with Merge Base…` | Show only the changes made on the current branch since it diverged. In detached HEAD it uses the only branch containing HEAD, otherwise asks which branch (or HEAD itself) to use. |
| `Git Studio: Compare Stash…` | Diff a stash against its parent commit. |
| `Git Studio: Compare File at Two Revisions…` | Diff one file between any two revisions. |
| `Git Studio: Compare Folder with Working Tree…` | Diff a folder against a ref from their merge base; the working-tree side stays editable. |
| `Git Studio: Compare Unpushed Commits…` | Diff `@{upstream}..HEAD` before pushing. |
| `Git Studio: Refresh` | Refresh the open history panel. |

### Ref picker

Every diff command picks refs through one grouped picker. For the two merge-base commands the first
entry is an inferred base branch, not `HEAD`:

1. `branch: Created from <ref>` in the branch reflog (strongest signal)
2. a tracking upstream, unless it is the same-named remote branch
3. the closest branch fully contained in the current branch (mainlines preferred)
4. the closest mainline to the merge base (covers a base branch that has moved on)

After the inferred base, all local and remote mainlines (`main`, `master`, `develop`, `dev`, `trunk`,
`next`, `stable`, `release/*`, plus `origin/HEAD`) are listed when the inferred branch is not itself a
mainline. `HEAD` is never offered by `Compare Current Branch with Merge Base` (it would compare the
branch with itself), while `Compare Working Tree with Merge Base` keeps `HEAD` after the mainlines
because it means "only uncommitted changes".

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitStudio.history.pageSize` | `500` | Commits loaded per page. |
| `gitStudio.history.defaultRefs` | `primary` | `primary` = current branch, its upstream, main/master/develop and pinned refs. `current` = current branch only. `all` = every ref. |
| `gitStudio.history.recentRefLimit` | `0` | Extra recently updated local branches to add in `primary` mode. |
| `gitStudio.history.pinnedRefs` | `[]` | Ref names or globs always included, e.g. `release/*`, `origin/main`. |
| `gitStudio.history.order` | `date` | `date` or `topo` ordering. |
| `gitStudio.annotate.enabled` | `false` | Enable blame annotations globally. |
| `gitStudio.annotate.template` | `${authorName} · ${authorDateAgo} · ${summary}` | Annotation text. |
| `gitStudio.annotate.ignoreWhitespace` | `true` | Pass `-w` to `git blame`. |
| `gitStudio.git.path` | `""` | Override the git executable. |

## Development

```sh
npm install
npm run build     # extension + webview
npm run typecheck
npm test
```

Press `F5` in VS Code to launch an Extension Development Host.

## Architecture

```
src/shared/protocol.ts     host <-> webview message contract
src/extension/git/         git process runner, log/refs/diff/blame/commit/remote/write/rebase
src/extension/graph/       pure lane layout for the commit graph
src/extension/history/     default ref selection for complex repositories
src/extension/host/        repository service, history panel, commit actions, journal, webview HTML
src/extension/features/    blame decorations
src/webview/               React history UI (virtual list + SVG graph)
```

- Repository discovery uses the built-in Git extension API (`getAPI(1)`).
- Heavy reads (log, blame, diff-tree, refs) spawn `git` directly with
  `GIT_OPTIONAL_LOCKS=0`, using the same executable the built-in extension resolved.
- The graph layout is a pure function, unit-tested independently of rendering.
- The webview stores only filters, selection and scroll anchor in `setState`; commit
  data is re-requested when the panel becomes visible.

## Complex histories

The graph is only as wide as the refs you ask for. The default `primary` mode shows the
current branch, its upstream, `main`/`master`/`develop` and anything in
`gitStudio.history.pinnedRefs`. On repositories with hundreds of branches this keeps the
graph at a handful of lanes instead of dozens.

- Add a branch family: `"gitStudio.history.pinnedRefs": ["release/*", "origin/main"]`.
- Add the N most recently updated local branches: `"gitStudio.history.recentRefLimit": 4`.
- Pick arbitrary refs per session with the refs button in the toolbar.
- `"gitStudio.history.defaultRefs": "all"` restores the full topology (and the full width).

## Limitations

- Merge commits are flattened during interactive rebase.
- Merge commit file lists use the selected parent's diff; rename detection is on.
- `all` mode can be slow and wide on repositories with hundreds of refs; `primary` is the default for that reason.
- The built-in Git extension must be enabled for repository discovery.
- "Open on Remote" supports github.com, gitlab.com (and GitLab-like hosts) and bitbucket.org.
