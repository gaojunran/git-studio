# Issues, pull requests and discussions

`Git Studio: Open Issues & Pull Requests` opens the board as an editor panel. It reads the active
repository's remote and supports GitHub, GitLab, Gitea and Gerrit out of the box. Other hosts can be
provided by OpenChamber integration packages.

## Board

- Tabs: issues, pull requests and GitHub discussions. Installed tracker packages add a **Tracker** tab
  with work items, states, labels, assignees and comments.
- Search and open/closed/all filter, paged list, split preview.
- Light, dark and high-contrast themes follow `--vscode-*` variables; there is no fixed palette.
- Labels and reviewers use searchable multi-select pickers.
- Merge is one split button that remembers the last method.
- Close offers host-specific reasons; draft PRs can be marked ready.
- Checks open in a dialog; review threads are shown and GitHub threads can be replied to.
- Tracker items can change state and receive comments when the manifest declares those capabilities.

## Commit linkage

History scans commit messages for `#123`, `!123` and issue/PR/MR URLs. Matches appear under
**Linked** and open the matching item in the board. GitHub, GitLab and Gitea also answer "which
change requests contain this commit" asynchronously; those appear as provider badges.

Guest integrations cannot answer that commit-to-change-request lookup because the OpenChamber
`source-control` contract has no such route. Message references still work for them.

## OpenChamber integration packages

An integration package runs unmodified:

1. Git Studio parses the `openchamber` manifest in its `package.json`.
2. Starts its `service/main.js` with a host-assigned port, token and callback URL.
3. Proxies `/source-control` or `/tracker` requests.
4. Answers outbound callbacks with a short-lived per-call handle.
5. Keeps the account token in VS Code SecretStorage; the service never sees it.

Install from:

- a folder: **Install Integration Extension…**
- a Git URL: **Install Integration Extension from Git…**
- a `.zip` or `.vsix`: **Install Integration Extension from Archive…**

A Git-installed package can be updated with **Update Integration Extension…**, which pulls and
reloads the manifest. When several providers match a repository, the board header switches between
them.

Supported roles:

- `source-control`: reads plus comment, state, merge, labels, reviewers, review, votes and ready
  writes when the manifest declares them.
- `tracker`: `items.list`, `items.get`, `items.updateState`, `states.list` and `comments.create`.

Guest review-thread creation is not part of the OpenChamber provider contract; GitHub's built-in
provider can reply to existing threads.
