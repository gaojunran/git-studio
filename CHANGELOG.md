# Changelog

## 0.20.0

- `Git Studio: History for Selection` follows the selected line range with `git log -L`; the range can
  be edited or cleared from the Filters panel.
- Changed files can be annotated at the selected revision; annotate now accepts `git:` documents and
  blames the requested ref.
- Changed files can drop their changes from a commit or extract them into a new commit, both through
  the rebase todo (`exec git checkout <hash>^ -- <path>`), with conflict Continue/Skip/Abort.

## 0.19.0

- Commit menu adds `Fixup Staged Changes into This Commit`, `Squash Staged Changes into This Commit`
  and `Push All up to Here`.
- Changed files collapse their actions into one `⋯` menu: preview diff inline, show diff, compare
  with working tree, compare before with working tree, file history, open at revision, copy path,
  get from revision, revert this file's changes and apply this file's changes to the working tree.

## 0.18.1

- Detail pane spacing: grouped message, metadata, linked items, files and footer with consistent
  padding, wider label column, wrapping refs, taller file rows and a fixed footer.
- Long commit bodies always offer `Show more` when the preview is clipped.
- Each changed file can be restored from the selected revision (`Get this file from this revision`),
  behind a confirmation and the write coordinator.

## 0.18.0

- A **Collapse** toggle hides the interior commits of linear side branches, keeping merge points and
  refs, so a busy graph stays readable without losing the mainline.
- Commit details add committer email, a separate commit date, GPG signature status and signer, and the
  refs pointing at the commit.
- Commit message hashes are clickable and jump to that commit.
- `←` / `→` jump to the parent / child commit while the history list has focus.
- Each changed file gets `Compare with Working Tree` and `Compare before with Working Tree` actions
  beside the existing diff, history and open-at-revision buttons.

## 0.17.2

- Fixed the missing icon on the `Rebase Current Branch onto This Commit…` menu item (`git-rebase` is
  not a VS Code codicon; it now uses `repo-push`).

## 0.17.1

- Change request titles render `#123`, `!123` and URLs as links; clicking a reference opens that item
  in the board.
- History skips the commit-to-change-request API lookup when the commit message already names one.

## 0.17.0

- Board now uses VS Code theme variables for backgrounds, text, borders, links and semantic colors in
  both light and dark themes instead of a fixed OpenChamber palette.
- Commit messages are scanned for issue/PR/MR references and URLs; each reference opens the matching
  item in the Board.
- Commit details asynchronously look up associated change requests (GitHub, GitLab, Gitea) and show
  them as linked badges.
- The Board can be opened focused on a specific item from History.

## 0.16.5

- `Linear` now only hides merge commits (`--no-merges`) instead of also applying `--first-parent`, so
  commits from merged branches are no longer dropped.

## 0.16.4

- Toolbar text is vertically centered in every button and the search input.
- Removed the redundant `Merges only` checkbox; `is:merge` remains available in search.
- Commit menu adds merge into current, rebase onto this commit, squash into parent, drop, copy URL
  and copy patch.
- History keeps its webview alive when hidden, so switching windows no longer reloads it.
- File diffs open beside the history panel as a preview tab, so the next file replaces the diff
  without navigating back.

## 0.16.3

- Removed the duplicate filter input; the search box keeps the GitHub-style tokens and the Filters
  panel keeps structured controls.
- Toolbar buttons now share one 28px height, including refresh and settings.
- Filtered history prunes parent lanes that are not in the result set, so `No merges` no longer leaves
  a huge empty graph gutter that pushed commit subjects off screen.

## 0.16.2

- Commit menu: Compare with Current Branch, Reword Commit, Copy Commit Message.
- History: Linear toggle (first parent, no merges); GitHub-style search tokens and a metadata filter
  box; local, remote and tag badges now use distinct colors.
- Detail panel scrolls as a whole; toolbar icon buttons share one height.

## 0.16.1

- Ref picker: show each commit's subject next to its hash; merge local and remote branches into one
  Branches group, with one cloud button per remote that has the same branch; Cmd+Shift+V opens
  Compare Working Tree with Merge Base.

## 0.16.0

- Board: searchable multi-select labels and reviewers, merge split button with remembered method, mark ready, close reasons, checks dialog, review threads, tracker state and comment writes, GitLab / Gitea / Gerrit built-in providers.
- History: stash workbench, reflog workbench with restore-on-branch, worktree workbench, folder and multi-path history, incoming/tag/remote-tracking/reflog compares, patch apply/export, graph SVG export, safer undo (`reset --keep`), persisted pending rebase undo, multi-line reword and drag reorder, blame ignore-revs/copy detection, configurable remote commit URL.

## 0.15.1

- Board: resizable split, narrow list overlay, listbox keyboard navigation, comment shortcut, detail refresh/retry, CSS loading spinner.

## 0.15.0

- Board: read-only Tracker tab for OpenChamber tracker guests, with state filters, item detail and comments.
