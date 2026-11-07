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
- Read-only by default: no history rewriting.

## Commands

| Command | Description |
| --- | --- |
| `Git Studio: Open History` | Open the history panel for the active repository. |
| `Git Studio: File History` | Show history for a file. |
| `Git Studio: Annotate File (Blame)` | Toggle full-file blame annotations. |
| `Git Studio: Toggle File Annotate` | Toggle annotations for the active editor. |
| `Git Studio: Open Commit in History` | Reveal a commit in the history panel. |
| `Git Studio: Refresh` | Refresh the open history panel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitStudio.history.pageSize` | `500` | Commits loaded per page. |
| `gitStudio.history.defaultRefs` | `all` | `all` or `current` when the panel opens. |
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
src/extension/git/         git process runner, log/refs/diff/blame/commit readers
src/extension/graph/       pure lane layout for the commit graph
src/extension/host/        repository service, history panel, webview HTML
src/extension/features/    blame decorations
src/webview/               React history UI (virtual list + SVG graph)
```

- Repository discovery uses the built-in Git extension API (`getAPI(1)`).
- Heavy reads (log, blame, diff-tree, refs) spawn `git` directly with
  `GIT_OPTIONAL_LOCKS=0`, using the same executable the built-in extension resolved.
- The graph layout is a pure function, unit-tested independently of rendering.
- The webview stores only filters, selection and scroll anchor in `setState`; commit
  data is re-requested when the panel becomes visible.

## Limitations

- Read-only: no reset, revert, cherry-pick or interactive rebase yet.
- Merge commit file lists use the selected parent's diff; rename detection is on.
- `--all` is the default ref set; repositories with hundreds of refs can take longer on
  a cold disk cache. Switch `gitStudio.history.defaultRefs` to `current` if needed.
- The built-in Git extension must be enabled for repository discovery.
