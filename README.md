# Git Studio

IntelliJ-style Git history for VS Code.

Git Studio keeps its surface small on purpose: one History panel plus a few native
editor enhancements. Staging, committing, branches, stashes, worktrees, diffs and
merge conflict resolution stay with the built-in Git extension, so there is only one
place to learn and one source of truth for repository state.

## Features

- Multi-ref commit graph (local branches, remotes, tags, detached HEAD) in an editor panel.
- History filters: message (plain or regex), author, path, date range, ref selection, ordering.
  The search box accepts GitHub-style tokens: `author:`, `path:`, `since:`, `until:`, `hash:`,
  `is:merge`, `is:no-merge`, `first-parent:`, `regex:`, `case:`. The **Filters** panel adds structured
  author, path, date, merge and ordering controls.
- A **Linear** toggle hides merge commits but keeps every non-merge commit, so it matches the
  `No merges` filter instead of dropping whole merged branches.
- Bounded loading: 500 commits per page, with virtual scrolling and incremental graph layout.
- Commit details: full message, parents, author/committer, changed files with per-file stats.
- Merge commits: switch the diff base between parent 1 and parent 2.
- Open a commit as a native multi-file diff; compare any two commits.
- Clicking a file in the detail pane opens its diff beside the history panel as a preview tab, so the
  next file replaces that diff without navigating back.
- File history with rename following (`git log --follow`), opened from Explorer, SCM or the editor.
- Full-file blame annotations with configurable template and clickable commit links.
- Compare the working tree with any branch, tag or commit using three-dot semantics (merge base to
  working tree), so commits unique to the other side never show up. The working-tree side of the diff
  is a real file URI, so it stays editable; untracked files are included as additions.
- Two-ref diffs come in both flavours: `Compare Two Refs` (two-dot, full trees) and
  `Compare Two Refs with Merge Base` (three-dot, right side since divergence).
- More diff commands: two refs, merge-base, stash, one file at two revisions, a folder, unpushed and
  incoming commits, tag vs previous tag, remote-tracking branches, and reflog entries.
- Stash workbench: list, inspect as a native multi-file diff, apply, pop, drop, and create stashes
  (all changes, include untracked, or staged only).
- Reflog workbench: inspect HEAD or any branch, compare a moment with HEAD or another ref, reset --hard,
  or restore it on a new branch. The rewrite undo journal is persisted across window reloads.
- Worktree workbench: list path/branch/HEAD/dirty, open in the current or a new window, create from any
  ref, remove and prune.
- Folder and multi-path history, with the path range shown in the panel title.
- Patch export/apply and history graph SVG export.
- Detached HEAD (jj workflows) is handled: the merge-base command resolves the only branch containing
  HEAD, and asks when several branches match instead of failing.
- Commit actions from the detail pane or a row right-click:
  create branch here, create tag here, checkout (detached), compare with current branch,
  compare with working tree, merge into current branch, rebase current branch onto this commit,
  open on GitHub/GitLab/Bitbucket, copy subject, message, hash, URL or patch.
- Reword, squash into parent or drop any commit on the current first-parent line from the same menu.
- History rewriting: reset (soft/mixed/hard), revert and cherry-pick from the same menu.
  Merge commits use parent 1. Conflicts surface in a banner with Abort action.
- Interactive rebase from any ancestor commit: reorder, pick, reword, edit, squash, fixup, drop.
  Merge commits are flattened. The rebase stops for `edit`/conflicts with Continue, Skip and Abort.
- Undo the last Git Studio rewrite from the toolbar. The journal keeps 20 entries per repository
  and is only offered while HEAD still matches the recorded result.
- Write safety: operations are serialized, the target commit is re-resolved, and HEAD is
  rechecked after confirmation; a merge/rebase/cherry-pick/revert in progress blocks new writes.
- Issues / pull requests / discussions board in its own editor panel: repository tabs, search,
  state filter, split list and preview, comments, close/reopen and merge for GitHub. The same
  board can be served by an unmodified OpenChamber source-control integration package.

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
| `Git Studio: Compare Incoming Commits…` | Diff `HEAD..@{upstream}` to preview what a pull would bring. |
| `Git Studio: Compare Tag with Previous Tag…` | Diff a tag against the previous tag by creation date. |
| `Git Studio: Compare Against Remote Tracking Branch…` | Diff a remote-tracking branch in either direction. |
| `Git Studio: Compare with Reflog Entry…` | Diff a reflog moment against HEAD. |
| `Git Studio: Stash Workbench…` | List, inspect, apply, pop, drop or create stashes. |
| `Git Studio: Reflog…` | Inspect reflog entries, compare, reset or restore on a branch. |
| `Git Studio: Restore HEAD from Reflog…` | Move HEAD back to the previous reflog entry. |
| `Git Studio: Worktrees…` | List, open, create, remove and prune worktrees. |
| `Git Studio: Folder History` | History for an Explorer folder. |
| `Git Studio: History for Selected Paths` | History for several selected files/folders as one path filter. |
| `Git Studio: Export Patch…` | Write `git diff --binary` for a commit or range. |
| `Git Studio: Apply Patch…` | Apply a patch with `--3way` behind the write coordinator. |
| `Git Studio: Export History Graph (SVG)…` | Write the first 500 commits of the graph as SVG. |
| `Git Studio: Refresh` | Refresh the open history panel. |
| `Git Studio: Open Issues & Pull Requests` | Open the board for the active repository. |
| `Git Studio: Connect GitHub for Board` | Store a GitHub token for the board. |
| `Git Studio: Install Integration Extension…` | Install a folder containing an OpenChamber source-control integration package. |
| `Git Studio: Install Integration Extension from Git…` | Clone a Git repository and install the integration package in it. |
| `Git Studio: Install Integration Extension from Archive…` | Install a `.zip` or `.vsix` containing an OpenChamber source-control integration package. |
| `Git Studio: Update Integration Extension…` | Pull a Git-installed integration and reload its manifest. |
| `Git Studio: Connect Integration Account…` | Connect a token to an installed integration. |
| `Git Studio: Remove Integration Extension…` | Forget an installed integration and its token. |

### Ref picker

Every diff command picks refs through one grouped picker. For the two merge-base commands the first
entry is an inferred base branch, not `HEAD`. Inference and mainlines are independent:

**Inference** only looks at branch relationships:

1. a tracking upstream, unless it is the same-named remote branch
2. `branch: Created from <ref>` in the branch reflog
3. otherwise, the closest fork point among the 20 most recently updated branches:
   ```bash
   git rev-list --count --left-right HEAD...<candidate>
   ```
   The left count is how many commits the current branch has since the fork point. Candidates are
   ranked by that count ascending, then by the candidate's last commit descending, then by name.
   The right count (how far the candidate advanced) is informational only: a base branch is allowed
   to move on, so it is never excluded or penalised for being ahead. A candidate at the exact same
   commit is skipped, and a local branch strictly ahead of the current branch is treated as a child
   branch rather than a base.

It never consults the mainline list.

**Mainlines** are a separate display list: if any `refs/remotes/<remote>/HEAD` exists, it is exactly
those remote default branches; otherwise it falls back to branches named `main` or `master`. They are
ordered by last commit.

After the inferred base, the other mainlines are listed; the inferred one is excluded from that group.
`HEAD` is never offered by `Compare Current Branch with Merge Base` (it would compare the branch
with itself), while `Compare Working Tree with Merge Base` keeps `HEAD` after the mainlines because
it means "only uncommitted changes".

The picker opens immediately and fills in after refs load. Lists are capped (20 mainlines, 40 local,
40 remote, 20 tags); `Show all refs…` loads the rest on demand. Branches contained in the current
branch are listed first inside each group, then the most recently updated ones.

## Issues and pull requests board

The board opens as an editor panel and reads the active repository's remote. GitHub, GitLab, Gitea and
Gerrit are built in; other hosts come from OpenChamber source-control integration packages.

- Tabs: issues, pull requests and, on GitHub, discussions. Installed tracker packages add a
  **Tracker** tab with their work items, states, labels, assignees and comments.
- Search and open/closed/all filter, paged list, split preview.
- Labels and reviewers use searchable multi-select pickers; merge is one split button that remembers
  the last method; close offers host-specific reasons; draft PRs can be marked ready.
- Checks open in a dialog, review threads are shown and GitHub threads can be replied to.
- Tracker items can change state and receive comments when the tracker declares those capabilities.
- An installed integration package runs unmodified: Git Studio parses its `openchamber` manifest,
  starts its `service/main.js`, proxies the source-control wire and keeps the token in VS Code
  SecretStorage. The package never sees the token; its forge calls go through Git Studio's outbound
  callback with a per-call handle.

Integration packages are installed from a folder, a Git URL or a `.zip` / `.vsix` archive with **Git Studio: Install Integration Extension…**,
**Install Integration Extension from Git…** or **Install Integration Extension from Archive…**. A Git-installed package can be updated with
**Update Integration Extension…**, which pulls and reloads its manifest. When more than one provider matches a repository,
the provider selector in the board header switches between them.
The first version supports the `source-control` role's reads plus comment, state, merge, labels,
reviewers, review, votes and ready writes when the manifest declares those capabilities, and the
`tracker` role's `items.list`, `items.get`, `items.updateState`, `states.list` and `comments.create`.
Guest review-thread creation is not part of the OpenChamber provider contract; GitHub's built-in
provider can reply to existing threads.

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
| `gitStudio.annotate.detectCopies` | `false` | Pass `-C -C` to `git blame` (slower, detects copies). |
| `gitStudio.annotate.ignoreRevsFile` | `""` | Path to `.git-blame-ignore-revs`, relative to the repository root. |
| `gitStudio.remote.commitUrlTemplate` | `""` | Custom commit URL for self-hosted hosts; `{url}` and `{hash}` are substituted. |
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
