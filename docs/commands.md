# Commands

All commands are in the **Git Studio** category in the command palette. Many are also available from
Source Control, Explorer, the editor context menu or the History panel.

## History and blame

| Command | Description |
| --- | --- |
| `Git Studio: Open History` | Open the history panel for the active repository. |
| `Git Studio: File History` | Show history for a file. |
| `Git Studio: History for Selection` | Show history for the selected line range (`git log -L`). |
| `Git Studio: Folder History` | History for an Explorer folder. |
| `Git Studio: History for Selected Paths` | History for several selected files/folders as one path filter. |
| `Git Studio: Annotate File (Blame)` | Toggle full-file blame annotations. |
| `Git Studio: Toggle File Annotate` | Toggle annotations for the active editor. |
| `Git Studio: Open Commit in History` | Reveal a commit in the history panel. |
| `Git Studio: Go to Commit…` | Jump to a hash, branch or tag. |
| `Git Studio: Undo Last Rewrite` | Reset back to the state recorded before the last rewrite. |
| `Git Studio: Refresh` | Refresh the open history panel. |

## Comparisons

| Command | Description |
| --- | --- |
| `Git Studio: Compare Working Tree with Merge Base…` | Diff a ref against the working tree from their merge base (three-dot). The working-tree side stays editable. |
| `Git Studio: Compare Two Refs…` | Diff any two branches, tags or commits (two-dot, full trees). |
| `Git Studio: Compare Two Refs with Merge Base…` | Diff any two refs from their merge base (three-dot); only changes on the right side appear. |
| `Git Studio: Compare Current Branch with Merge Base…` | Show only the changes made on the current branch since it diverged. Detached HEAD is resolved or chosen. |
| `Git Studio: Compare Stash…` | Diff a stash against its parent commit. |
| `Git Studio: Compare File at Two Revisions…` | Diff one file between any two revisions. |
| `Git Studio: Compare Folder with Working Tree…` | Diff a folder against a ref from their merge base; the working-tree side stays editable. |
| `Git Studio: Compare Unpushed Commits…` | Diff `@{upstream}..HEAD` before pushing. |
| `Git Studio: Compare Incoming Commits…` | Diff `HEAD..@{upstream}` to preview what a pull would bring. |
| `Git Studio: Compare Tag with Previous Tag…` | Diff a tag against the previous tag by creation date. |
| `Git Studio: Compare Against Remote Tracking Branch…` | Diff a remote-tracking branch in either direction. |
| `Git Studio: Compare with Reflog Entry…` | Diff a reflog moment against HEAD. |

## Workbenches and export

| Command | Description |
| --- | --- |
| `Git Studio: Stash Workbench…` | List, inspect, apply, pop, drop or create stashes. |
| `Git Studio: Reflog…` | Inspect reflog entries, compare, reset or restore on a branch. |
| `Git Studio: Restore HEAD from Reflog…` | Move HEAD back to the previous reflog entry. |
| `Git Studio: Worktrees…` | List, open, create, remove and prune worktrees. |
| `Git Studio: Export Patch…` | Write `git diff --binary` for a commit or range. |
| `Git Studio: Apply Patch…` | Apply a patch with `--3way` behind the write coordinator. |
| `Git Studio: Export History Graph (SVG)…` | Write the first 500 commits of the graph as SVG. |

## Board and integrations

| Command | Description |
| --- | --- |
| `Git Studio: Open Issues & Pull Requests` | Open the board for the active repository. |
| `Git Studio: Connect GitHub for Board` | Store a GitHub token for the board. |
| `Git Studio: Install Integration Extension…` | Install a folder containing an OpenChamber integration package. |
| `Git Studio: Install Integration Extension from Git…` | Clone a Git repository and install the integration package in it. |
| `Git Studio: Install Integration Extension from Archive…` | Install a `.zip` or `.vsix` containing an OpenChamber integration package. |
| `Git Studio: Update Integration Extension…` | Pull a Git-installed integration and reload its manifest. |
| `Git Studio: Connect Integration Account…` | Connect a token to an installed integration. |
| `Git Studio: Remove Integration Extension…` | Forget an installed integration and its token. |

## History panel context menu

Right-click a commit or use `⋯` in the detail pane:

- Create Branch Here… / Create Tag Here…
- Checkout Commit (Detached)…
- Compare with Current Branch / Working Tree
- Merge into Current Branch / Rebase Current Branch onto This Commit
- Reset Current Branch to Here… (soft / mixed / hard)
- Revert Commit / Cherry-pick onto Current Branch
- Reword Commit / Squash Commit into Parent / Drop Commit
- Fixup Staged Changes into This Commit / Squash Staged Changes into This Commit
- Push All up to Here
- Interactively Rebase from Here…
- Open Commit on Remote
- Copy Subject / Message / Hash / URL / Patch

## Default keybindings

| Key | Command |
| --- | --- |
| `⌘/Ctrl+Alt+H` | Open History |
| `⌘/Ctrl+Shift+V` | Compare Working Tree with Merge Base |
