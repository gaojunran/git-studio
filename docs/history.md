# History

`Git Studio: Open History` opens the History panel in the editor area. It is a WebView with a
virtualized commit list, an SVG graph overlay, and a detail pane.

## Graph and refs

- Shows local branches, remote-tracking branches, tags and detached HEAD.
- Default ref mode is `primary`: current branch (or `HEAD` when detached), its upstream, mainlines,
  pinned refs, and optionally N recently updated local branches. This keeps large repositories to a
  handful of lanes instead of dozens.
- Use the refs button in the toolbar to select arbitrary refs for the session.
- With `HEAD` detached, the panel still works; the merge-base commands resolve a containing branch or
  ask you to choose one.

### Complex histories

```jsonc
{
  "gitStudio.history.defaultRefs": "primary", // primary | current | all
  "gitStudio.history.recentRefLimit": 4,
  "gitStudio.history.pinnedRefs": ["release/*", "origin/main"]
}
```

`all` restores the full topology and can be slow/wide on repositories with thousands of refs.

## Filtering

The search box accepts plain text and GitHub-style tokens:

```text
author:junrangao
path:src/component
since:2026-01-01
until:2026-06-30
hash:cf53d53
is:merge
is:no-merge
first-parent:true
regex:true
case:true
```

Example:

```text
fix author:weigizhu path:src is:no-merge
```

The **Filters** panel adds structured controls for message, author, path, date range, first-parent,
no-merges and order (`date` / `topo`).

### Toolbar toggles

| Toggle | Effect |
| --- | --- |
| **Linear** | Hides merge commits with `--no-merges`; keeps every non-merge commit. |
| **Collapse** | Hides interior commits of linear side branches; keeps mainline, refs and merge points. |
| **Columns** | Shows/hides graph, subject, refs, author, date and hash; Date can use author or commit time. |
| **All repositories** | Merges every workspace repository into one date-ordered list; selecting a row switches repository. |

Visual markers: your own commits are bold, the current branch is tinted, merge commits are muted, and
unpushed commits carry a dot.

## Pagination

History loads 500 commits per page (`gitStudio.history.pageSize`) with virtual scrolling and
auto-loads as you approach the end. A host-side cursor keeps repeated appends monotonic.

## Commit details

The detail pane shows:

- full hash, subject and body;
- author and committer names/emails;
- authored and committed timestamps;
- GPG signature status and signer when present;
- branches and tags pointing at the commit;
- parents, with merge-parent switching for the diff base;
- changed files with `+/-` stats and per-file actions;
- issue/PR/MR references found in the message, plus change requests associated with the commit
  (GitHub, GitLab, Gitea).

`←` / `→` jump to the parent or child commit while the list has focus. Hashes in the message are
clickable.

## Commit actions

Right-click a row or use the detail pane's `⋯`:

- Create branch here / Create tag here
- Checkout commit (detached)
- Compare with current branch / working tree
- Merge into current branch / Rebase current branch onto this commit
- Reset current branch here (soft / mixed / hard)
- Revert, cherry-pick
- Reword, squash into parent, drop
- Fixup/squash staged changes into this commit
- Push all up to here
- Interactively rebase from here
- Open on GitHub/GitLab/Bitbucket
- Copy subject, message, hash, URL or patch

Merge commits use parent 1 as the mainline unless you switch the diff base to parent 2.

## Per-file actions

Each changed file has one `⋯` menu with:

- inline diff preview, show diff
- compare with working tree, compare the parent with working tree
- file history, open at this revision, annotate this revision
- copy path, get this file from this revision
- revert this file's changes / apply this file's changes to the working tree
- drop this file's changes from the commit / extract them into a new commit

## Interactive rebase

`Interactively Rebase from Here…` opens a planning dialog for every commit above the selected base:

- reorder with ↑/↓ or drag
- **pick**, **reword**, **edit**, **squash**, **fixup**, **drop**
- validation: the first kept commit cannot be squash/fixup; at least one commit must remain; a reword
  message cannot be empty

Merge commits are flattened (`--no-merges`). The rebase runs headlessly through
`GIT_SEQUENCE_EDITOR`; `reword` becomes `pick` + `exec git commit --amend -F <file>`. A stopped rebase
or conflict shows **Continue**, **Skip** and **Abort**.

## Undo

Every successful reset/revert/cherry-pick/rebase is recorded in a per-repository journal (last 20).
**Undo** is offered only while HEAD still equals the recorded result, so it cannot wipe commits made
after the rewrite. It runs `reset --hard <before>` behind a confirmation.

## File and line history

- **File History** follows renames with `git log --follow`.
- **Line History** uses `git log -L<start>,<end>:<path>` for the selection or cursor line.
- Both are available from the Source Control sidebar views, Explorer/editor context menus and the
  command palette.
- Clicking a commit opens the native diff for that file; **Commits** opens the whole commit as a
  multi-file diff.

## Blame

`Git Studio: Annotate File (Blame)` adds per-line annotations using `git blame`, with a configurable
template and clickable commit links. Supports `-w`, `-M`, `-C -C` and `.git-blame-ignore-revs`.

## Native Source Control views

The SCM sidebar adds:

- **File History** — active file, rename-aware.
- **Line History** — selection or cursor line.
- **Commits** — current branch linear history, with merge toggle, paging and filters for message,
  author, path, date range, order and first-parent.

These views remember the last file editor even when the sidebar has focus.
