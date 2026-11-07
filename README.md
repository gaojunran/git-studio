# Git Studio

IntelliJ-style Git history for VS Code.

Git Studio is deliberately small in surface area: one History panel plus a few native
editor enhancements. Staging, committing, branches, stashes, worktrees, diffs and
merge conflict resolution stay with the built-in Git extension.

## Features

- Multi-ref commit graph (local branches, remotes, tags, HEAD) in a dedicated panel.
- History search: message (plain or regex), author, path, date range, refs.
- Commit details: full message, parents, author/committer, changed files with stats.
- Open commit changes as a native multi-file diff; compare any two commits.
- File history with rename following (`git log --follow`).
- Full-file blame annotations with clickable commit links.
- Safe, read-only by default: no history rewriting in 0.1.

## Commands

| Command | Description |
| --- | --- |
| `Git Studio: Open History` | Open the history panel for the active repository. |
| `Git Studio: File History` | Show history for a file (from Explorer, SCM, editor, or palette). |
| `Git Studio: Annotate File (Blame)` | Toggle full-file blame annotations for the active editor. |
| `Git Studio: Open Commit in History` | Reveal a commit in the history panel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitStudio.history.pageSize` | `500` | Commits loaded per page. |
| `gitStudio.history.defaultRefs` | `all` | Refs selected when the panel opens. |
| `gitStudio.history.order` | `date` | `date` or `topo` ordering. |
| `gitStudio.annotate.enabled` | `false` | Enable blame annotations. |
| `gitStudio.annotate.template` | see settings UI | Annotation text template. |
| `gitStudio.annotate.ignoreWhitespace` | `true` | Pass `-w` to `git blame`. |
| `gitStudio.git.path` | `""` | Override the git executable. |

## Development

```sh
npm install
npm run build
npm test
```

Press `F5` in VS Code to launch an Extension Development Host.

The extension host reads heavy history data by spawning `git` directly (log, blame,
diff-tree, refs) and uses the built-in Git extension API only for repository discovery.
Read-only git calls run with `GIT_OPTIONAL_LOCKS=0`.

## Architecture

```
src/shared/protocol.ts     host <-> webview message contract
src/extension/git/         git process runner, log/refs/diff/blame readers
src/extension/graph/       pure lane layout for the commit graph
src/extension/host/        repository service, history panel, webview HTML
src/extension/features/    blame decorations, commands
src/webview/               React history UI (virtual list + SVG graph)
```
