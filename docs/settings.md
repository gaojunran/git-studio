# Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitStudio.history.pageSize` | `500` | Commits loaded per page. |
| `gitStudio.history.defaultRefs` | `primary` | `primary` = current branch, its upstream, mainlines and pinned refs. `current` = current branch only. `all` = every ref. |
| `gitStudio.history.recentRefLimit` | `0` | Extra recently updated local branches to add in `primary` mode. |
| `gitStudio.history.pinnedRefs` | `[]` | Ref names or globs always included, e.g. `release/*`, `origin/main`. |
| `gitStudio.history.columns` | `graph, subject, refs, author, date` | Columns shown in the commit list. |
| `gitStudio.history.timeField` | `author` | `author` or `commit` timestamp for the Date column. |
| `gitStudio.history.order` | `date` | `date` or `topo` ordering. |
| `gitStudio.annotate.enabled` | `false` | Enable blame annotations globally. |
| `gitStudio.annotate.template` | `${authorName} · ${authorDateAgo} · ${summary}` | Annotation text. |
| `gitStudio.annotate.ignoreWhitespace` | `true` | Pass `-w` to `git blame`. |
| `gitStudio.annotate.detectCopies` | `false` | Pass `-C -C` to `git blame` (slower). |
| `gitStudio.annotate.ignoreRevsFile` | `""` | Path to `.git-blame-ignore-revs`, relative to the repository root. |
| `gitStudio.remote.commitUrlTemplate` | `""` | Custom commit URL for self-hosted hosts; `{url}` and `{hash}` are substituted. |
| `gitStudio.git.path` | `""` | Override the git executable. |

## Examples

### Keep a few long-lived branches visible

```jsonc
{
  "gitStudio.history.pinnedRefs": ["release/*", "origin/main", "origin/develop"],
  "gitStudio.history.recentRefLimit": 4
}
```

### Show only the current branch

```jsonc
{
  "gitStudio.history.defaultRefs": "current"
}
```

### Custom transform for self-hosted Git

```jsonc
{
  "gitStudio.remote.commitUrlTemplate": "https://git.example.com/project/commit/{hash}"
}
```
