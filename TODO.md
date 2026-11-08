# Git Studio — TODO

> 当前版本：`0.21.0`
> 定位：IntelliJ Log 风格的 Git 历史工作台。History 用 WebView，其余尽量复用 VS Code 原生 UI。

## 已完成（基线）

- [x] History 面板：多 ref 提交图、虚拟滚动、增量分页、SVG 图层
- [x] 过滤：message（普通 / 正则 / 大小写）、author、path、日期、ref 多选、first-parent、no-merges、date/topo
- [x] 提交详情：完整 message、author/committer、parents、文件列表与 ±stats
- [x] merge commit 在 parent 1 / parent 2 之间切换 diff 基准
- [x] 打开提交的原生多文件 diff；任意两个 commit 对比
- [x] `git log --follow` 文件历史
- [x] 全文件 blame 注解 + hover（可配置模板、`-w`、`-M`、`-C -C`、`.git-blame-ignore-revs`）
- [x] 提交操作：建分支、建 tag、detached checkout、与工作区对比、打开远程提交、复制 subject/hash
- [x] 历史改写：reset（soft/mixed/hard）、revert、cherry-pick
- [x] 交互式 rebase：reorder / drag / pick / reword（多行）/ edit / squash / fixup / drop，含 Continue / Skip / Abort
- [x] 最近一次改写的 Undo（每仓库 journal 20 条，`reset --keep`，pending rebase 落盘）
- [x] 写操作安全：串行、目标 OID 复核、HEAD 复核、进行中操作阻断、冲突横幅
- [x] diff 命令集：working tree ↔ merge base、two refs、two refs ↔ merge base、current branch ↔ merge base、stash、file at two revisions、folder、unpushed、incoming、tag vs previous、remote tracking、reflog entry
- [x] ref 选择器：立即弹出、加载后填充、分组限量、Show all、基准分支推断、主干独立列表
- [x] 文件详情操作：打开该版本、复制路径、文件历史
- [x] History 键盘导航（↑/↓、Enter、Esc）
- [x] 自定义 remote commit URL 模板（`{url}` / `{hash}`）
- [x] 目录历史 / 多路径历史（Explorer 文件夹右键、多选路径）
- [x] Stash 工作台：列表、详情 diff、apply / pop / drop、创建（all / untracked / staged）
- [x] Reflog 工作台：HEAD / 分支 reflog、查看、与 HEAD / 任意 ref 对比、reset --hard、在新分支恢复
- [x] Worktree 工作台：列表、dirty、当前/新窗口打开、创建、remove、prune
- [x] 多仓库：History 面板内快速切换
- [x] Branches 侧栏：收藏、本地/远程/tag 分组、ahead/behind、checkout/create/rename/delete/merge/rebase/favorite
- [x] 列配置：graph / subject / refs / author / date / hash，author/commit 时间切换
- [x] 视觉标记：自己的提交加粗、当前分支底色、merge 灰显、未推送圆点
- [x] 多仓库统一 Log：按时间合并所有仓库、repo 徽标、选中后切换仓库
- [x] patch 导出 / 应用、历史图 SVG 导出
- [x] CI（typecheck / vitest / build / VSIX）与 changelog
- [x] 集成冒烟脚本移入 `test/integration`，提供 `npm run test:integration`

## Board / OpenChamber

- [x] GitHub 内置 provider：issue / PR / discussion 读，comment / close / merge / labels / reviewers / review / votes / mark ready / close reason / checks / review threads
- [x] 内置 provider：GitLab / Gitea / Gerrit
- [x] Guest Host：folder / Git / zip / VSIX 安装、manifest 解析、service spawn、loopback 代理、outbound callback、SecretStorage token
- [x] Guest Host 写操作：comment / close / merge / labels / reviewers / review / votes / mark ready / review thread reply（GitHub）
- [x] Tracker tab：items.list / items.get / items.updateState / comments.create / states.list
- [x] 多 provider 切换
- [x] Board UI：可调分栏、窄屏列表浮层、键盘导航、搜索、筛选、分页、详情、评论、Merge 分裂按钮、Close 原因、Checks 弹窗、Review threads、Tracker 状态/评论
- [x] Board UI 与 OpenChamber 的布局、间距、字体、颜色和交互对齐（以静态预览和真实 VS Code 截图验收）
- [x] Board 主题跟随 VS Code 的 light / dark / high-contrast 变量
- [x] History 提交引用与关联 MR/PR 联动 Board

## 已知边界

- Guest Host 的 `source-control` 契约没有 review thread 的创建/回复方法；因此 guest provider 只能展示 provider 返回的线程，GitHub 内置 provider 支持回复。
- Guest Host 的 tracker 契约没有项目映射 UI；容器名称会展示，映射由 OpenChamber 宿主负责。
- `--rebase-merges` 未启用：交互式 rebase 仍按 `--no-merges` 展平 merge commit，因为自定义 todo 与 git 的 merge label 语义无法安全混用。
- 当前 **Collapse** 只隐藏侧分支内部提交，不是把一条侧分支折叠成一行摘要；真正的 lane folding 仍未实现。
- 大仓库 `loadRefs` 冷启动仍在 1s 量级；ref picker 已改为异步填充，不阻塞弹窗。

## 后续候选（未排期）

- 交互式 rebase 支持 `--rebase-merges`，保留 merge commit 结构。
- 真正的 lane folding：把无可见节点的侧分支折叠成一条灰色摘要行，可展开。
- 向 OpenChamber 上游提议 guest 契约：commit → MR 批量反查、review threads 读写、逐条 checks、close reason、timeline DTO。
- Board：创建/编辑 PR/MR、submit requirements、Gerrit revisions、附件上传。
- 性能：只有在实测解析或 layout 占关键路径 ≥40% 且优化后仍 ≥2× 时才考虑 worker / Rust。
- Marketplace 发布与自动更新。

## 非目标（明确不做）

- 不做 staging / commit / discard：继续复用 VS Code 内置 Source Control。
- 不做 diff / merge 渲染：继续复用原生 diff editor 与 3-way merge。
- 不做自定义 SCM Provider。
- v1 不引入 Rust；只有实测瓶颈（解析或 layout ≥40% 关键路径且优化后仍 ≥2×）才重新评估。

## 验证清单（每个实现收尾）

- [x] `npm run typecheck` = 0
- [x] `npx vitest run` 全绿
- [x] `npm run build` 成功
- [x] 真实 VS Code Extension Host 冒烟（workspace trust 关闭）
- [x] 在真实大仓库验证（至少 `Work/main` 或 `wxapplib`）
- [x] 涉及写操作时，在临时仓库验证成功 / 冲突 / abort 三条路径
- [x] `npm run install:local` 覆盖安装，用户只需 Reload Window
