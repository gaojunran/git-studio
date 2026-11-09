# Limitations and non-goals

## Git and platform

- The built-in Git extension must stay enabled for repository discovery, `git:` documents and the
  native diff/merge editors.
- Interactive rebase flattens merge commits (`--no-merges`).
- Merge commit file lists use the selected parent's diff; rename detection is on.
- `all` ref mode can be slow and wide on repositories with hundreds of refs; `primary` is the default.
- Open on Remote supports github.com, gitlab.com (and GitLab-like hosts) and bitbucket.org. Other hosts
  can use `gitStudio.remote.commitUrlTemplate`.
- VS Code does not let an extension add buttons to the native Graph title or history-item context menu
  without proposed APIs; Git Studio uses stable menus only.
- A guest OpenChamber `source-control` package cannot answer "which change requests contain this
  commit" because that route is not in the provider contract.
- Guest review-thread creation is not in the OpenChamber contract; GitHub's built-in provider can
  reply to existing threads.

## Deliberate non-goals

Git Studio does not reimplement:

- staging / committing in a custom UI (the native Source Control view and diff editor handle it);
- diff rendering or three-way merge;
- a custom SCM provider;
- clone, init or remote management;
- Rust acceleration in v1. A native module is only justified if profiling shows parsing or graph
  layout dominates the critical path and a module would improve it by at least 2×.

## Known edge cases

- Reword supports single-line messages; use edit + native amend for multi-line.
- Reloading the window while a rebase is stopped at a conflict or `edit` keeps Continue/Abort working
  but the in-memory undo entry for that operation is not recorded.
- Undo uses `reset --hard`; tracked working-tree changes are lost after confirmation, untracked files
  survive.
- Lane folding is a visual collapse of linear side branches, not a full compress/expand model of the
  graph.
