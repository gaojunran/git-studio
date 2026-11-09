# Development

## Requirements

- Node.js 20+
- VS Code 1.95+ for testing

## Build and test

```sh
npm install
npm run build      # extension + history webview + board
npm run typecheck
npm test
```

Press `F5` in VS Code to launch an Extension Development Host.

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run build:ext` | esbuild bundle for the extension host. |
| `npm run build:web` | Vite bundle for the History WebView. |
| `npm run build:board` | Vite bundle for the Board WebView. |
| `npm run build:sidebar` | Build the unused workspace sidebar (kept for future use). |
| `npm run watch` | Rebuild extension and webviews on change. |
| `npm run install:local` | Build, package and force-install the VSIX locally. |
| `npm run test:integration` | Real VS Code smoke tests. |

## Architecture

```text
src/shared/              message contracts shared by host and webviews
src/extension/git/       git runner, log, refs, diff, blame, commit, rebase, write coordinator
src/extension/graph/     pure commit-graph lane layout
src/extension/history/   default ref selection
src/extension/host/      repository service, history panel, commit actions, journal, webview HTML
src/extension/features/  diffs, stash, reflog, worktree, export, annotate, compare
src/extension/board/     board panel, built-in providers, OpenChamber guest host
src/extension/scmViews/  native Source Control tree views
src/webview/             React History UI (virtual list + SVG graph)
src/board/               React Board UI
```

Key decisions:

- Repository discovery uses the built-in Git extension API `getAPI(1)`.
- Heavy reads spawn `git` directly with `GIT_OPTIONAL_LOCKS=0`, using the same executable the built-in
  extension resolved.
- Graph layout is a pure function with unit tests, independent of rendering.
- The History WebView stores filters, selection and scroll anchor in `setState`; commit data is
  re-requested when the panel becomes visible.
- The History panel uses `retainContextWhenHidden` so switching windows does not reload it.
- Writes share one coordinator per repository and never race the user's own Git commands in the
  extension host.

## Packaging

```sh
npx @vscode/vsce package --no-dependencies --out dist/git-studio-$npm_package_version.vsix
```

`npm run install:local` wraps build, package and `code --install-extension --force`.

## Publishing

The Marketplace publisher is `gaojunran`. Publish with a Personal Access Token that has
**Marketplace → Manage** scope:

```sh
VSCE_PAT=... npx @vscode/vsce publish --no-dependencies
```

Alternatively use Microsoft Entra ID:

```sh
npx @vscode/vsce publish --azure-credential --no-dependencies
```
