# Git Studio

IntelliJ-style Git history for VS Code: a multi-ref commit graph, deep history search, full-file
blame, reflog/stash/worktree workbenches, and an issues/PR board — while keeping staging, committing,
diffs and merge conflicts in the native Git experience.

## Why

VS Code's Source Control view is good at the working tree but limited at reading and rewriting
history. Git Studio adds one focused History surface and a few native entry points, without replacing
`git`, the native diff editor, or the merge editor.

## Highlights

- **History panel** — multi-ref graph, virtual scrolling, filters by message, author, path, date and
  refs, GitHub-style search tokens, configurable columns, and an all-repositories view.
- **Commit details** — author/committer identity, GPG signature, refs pointing at the commit, changed
  files with per-file actions, merge-parent switching, and links to issues/PRs in the board.
- **Native sidebar views** — File History, Line History (`git log -L`) and Commits, registered in
  Source Control.
- **History workbenches** — stash, reflog, worktree, patch export/apply and graph SVG export.
- **Diff commands** — compare refs, merge bases, working tree, folders, files at two revisions,
  unpushed/incoming commits, tags, remote-tracking branches and reflog entries.
- **History rewriting** — reset, revert, cherry-pick, reword, squash, drop, fixup/squash staged
  changes, push up to here, and interactive rebase; every write is serialized and re-validated.
- **Undo** — the last 20 Git Studio rewrites per repository, offered only while HEAD still matches.
- **Board** — issues, pull requests and discussions for GitHub, GitLab, Gitea and Gerrit, plus
  unmodified OpenChamber integration packages and tracker work items.

## Quick start

1. Install **Git Studio** from the Marketplace.
2. Open the command palette and run **Git Studio: Open History** (`⌘/Ctrl+Alt+H`).
3. Click a commit to inspect it; click a changed file to open its native diff.
4. Right-click a commit for branch, tag, diff, copy and rewrite actions.

The built-in Git extension must stay enabled: Git Studio uses it for repository discovery, `git:` URIs
and the native diff/merge editors.

## Documentation

| Document | Contents |
| --- | --- |
| [History](https://github.com/gaojunran/git-studio/blob/main/docs/history.md) | Graph, filters, columns, commit details, file/line history, rewriting. |
| [Diffs](https://github.com/gaojunran/git-studio/blob/main/docs/diffs.md) | Every compare command and the merge-base/ref-picker rules. |
| [Workbenches](https://github.com/gaojunran/git-studio/blob/main/docs/workbenches.md) | Stash, reflog, worktree, patch and graph export. |
| [Board](https://github.com/gaojunran/git-studio/blob/main/docs/board.md) | Issues/PRs/discussions and OpenChamber integration packages. |
| [Commands](https://github.com/gaojunran/git-studio/blob/main/docs/commands.md) | Full command palette reference. |
| [Settings](https://github.com/gaojunran/git-studio/blob/main/docs/settings.md) | Every setting and its default. |
| [Development](https://github.com/gaojunran/git-studio/blob/main/docs/development.md) | Architecture, build, tests and release. |
| [Limitations](https://github.com/gaojunran/git-studio/blob/main/docs/limitations.md) | Known constraints and non-goals. |

## Requirements

- VS Code 1.95 or newer.
- The built-in Git extension enabled.
- `git` available on `PATH`, or `gitStudio.git.path` set.

## License

MIT. See [LICENSE](LICENSE).
